// Vulkan do M02: importa o dma-buf do quadro do Chromium como VkImage (com o modifier que veio) e copia, na placa,
// para um buffer exportável (OPAQUE_FD) que a CUDA importa e o NVENC lê. Nenhum byte do quadro passa pela CPU,
// exceto na leitura de conferência, pedida só nos quadros conferidos.
use ash::{ext, khr, vk};
use std::collections::HashMap;
use std::ffi::CStr;
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd};
use std::os::unix::fs::MetadataExt;

const NVIDIA: u32 = 0x10de;
const FORMATO: vk::Format = vk::Format::B8G8R8A8_UNORM;

pub struct Quadro {
    pub fd: OwnedFd,
    pub stride: u32,
    pub offset: u32,
    pub modifier: u64,
}

pub struct Exportavel {
    pub buffer: vk::Buffer,
    memoria: vk::DeviceMemory,
    // Depois da primeira cópia o buffer fica com a CUDA (QUEUE_FAMILY_EXTERNAL) e é retomado a cada quadro.
    na_cuda: bool,
}

struct Importada {
    imagem: vk::Image,
    memoria: vk::DeviceMemory,
}

struct Conferencia {
    buffer: vk::Buffer,
    memoria: vk::DeviceMemory,
    ponteiro: *const u8,
}

pub struct Vulkan {
    _entry: ash::Entry,
    instancia: ash::Instance,
    #[cfg_attr(not(test), allow(dead_code))] // só os testes consultam os modifiers
    fisico: vk::PhysicalDevice,
    dispositivo: ash::Device,
    memoria_fd: khr::external_memory_fd::Device,
    semaforo_fd: khr::external_semaphore_fd::Device,
    // Recebe a cerca implícita do dma-buf (sync_file) a cada quadro, por importação temporária.
    espera: vk::Semaphore,
    /// Quadros que chegaram com a escrita do Chromium ainda pendente na placa.
    pub cercas_pendentes: u32,
    /// Quadros em que o dma-buf não deu sync_file (sem como esperar a escrita).
    pub sem_sync_file: u32,
    propriedades: vk::PhysicalDeviceMemoryProperties,
    fila: vk::Queue,
    familia: u32,
    pool: vk::CommandPool,
    comandos: vk::CommandBuffer,
    cerca: vk::Fence,
    largura: u32,
    altura: u32,
    // M03: linhas da faixa da marca abaixo do quadro (0 = sem faixa). A imagem do Chromium tem altura + marca
    // linhas; só as `altura` de cima vão para o NVENC, e uma linha do meio da faixa vai para a CPU.
    marca: u32,
    // O Chromium recicla poucos buffers: a chave é o inode do dma-buf, então cada um é importado uma vez só.
    importadas: HashMap<(u64, u64), Importada>,
    exportaveis: Vec<Exportavel>,
    conferencia: Conferencia,
    faixa: Conferencia,
}

fn erro(contexto: &str) -> impl Fn(vk::Result) -> String + '_ {
    move |r| format!("{contexto}: {r:?}")
}

impl Vulkan {
    #[cfg(test)]
    pub fn new(largura: u32, altura: u32) -> Result<Self, String> {
        Self::com_marca(largura, altura, 0)
    }

    pub fn com_marca(largura: u32, altura: u32, marca: u32) -> Result<Self, String> {
        let entry = unsafe { ash::Entry::load() }.map_err(|e| format!("libvulkan: {e}"))?;
        let app = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_3);
        let instancia = unsafe {
            entry.create_instance(
                &vk::InstanceCreateInfo::default().application_info(&app),
                None,
            )
        }
        .map_err(erro("vkCreateInstance"))?;

        let fisico = unsafe { instancia.enumerate_physical_devices() }
            .map_err(erro("vkEnumeratePhysicalDevices"))?
            .into_iter()
            .find(|&f| unsafe { instancia.get_physical_device_properties(f) }.vendor_id == NVIDIA)
            .ok_or("sem placa NVIDIA no Vulkan")?;
        let familia = unsafe { instancia.get_physical_device_queue_family_properties(fisico) }
            .iter()
            .position(|f| {
                f.queue_flags
                    .intersects(vk::QueueFlags::GRAPHICS | vk::QueueFlags::COMPUTE)
            })
            .ok_or("sem fila com transferência")? as u32;

        let extensoes: [&CStr; 5] = [
            khr::external_memory_fd::NAME,
            khr::external_semaphore_fd::NAME,
            ext::external_memory_dma_buf::NAME,
            ext::image_drm_format_modifier::NAME,
            ext::queue_family_foreign::NAME,
        ];
        let nomes: Vec<_> = extensoes.iter().map(|n| n.as_ptr()).collect();
        let prioridade = [1.0];
        let filas = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(familia)
            .queue_priorities(&prioridade)];
        let dispositivo = unsafe {
            instancia.create_device(
                fisico,
                &vk::DeviceCreateInfo::default()
                    .queue_create_infos(&filas)
                    .enabled_extension_names(&nomes),
                None,
            )
        }
        .map_err(erro("vkCreateDevice"))?;

        let memoria_fd = khr::external_memory_fd::Device::new(&instancia, &dispositivo);
        let semaforo_fd = khr::external_semaphore_fd::Device::new(&instancia, &dispositivo);
        let espera =
            unsafe { dispositivo.create_semaphore(&vk::SemaphoreCreateInfo::default(), None) }
                .map_err(erro("vkCreateSemaphore"))?;
        let propriedades = unsafe { instancia.get_physical_device_memory_properties(fisico) };
        let fila = unsafe { dispositivo.get_device_queue(familia, 0) };
        let pool = unsafe {
            dispositivo.create_command_pool(
                &vk::CommandPoolCreateInfo::default()
                    .queue_family_index(familia)
                    .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER),
                None,
            )
        }
        .map_err(erro("vkCreateCommandPool"))?;
        let comandos = unsafe {
            dispositivo.allocate_command_buffers(
                &vk::CommandBufferAllocateInfo::default()
                    .command_pool(pool)
                    .command_buffer_count(1),
            )
        }
        .map_err(erro("vkAllocateCommandBuffers"))?[0];
        let cerca = unsafe { dispositivo.create_fence(&vk::FenceCreateInfo::default(), None) }
            .map_err(erro("vkCreateFence"))?;

        let mut vulkan = Self {
            _entry: entry,
            instancia,
            fisico,
            dispositivo,
            memoria_fd,
            semaforo_fd,
            espera,
            cercas_pendentes: 0,
            sem_sync_file: 0,
            propriedades,
            fila,
            familia,
            pool,
            comandos,
            cerca,
            largura,
            altura,
            marca,
            importadas: HashMap::new(),
            exportaveis: Vec::new(),
            conferencia: Conferencia {
                buffer: vk::Buffer::null(),
                memoria: vk::DeviceMemory::null(),
                ponteiro: std::ptr::null(),
            },
            faixa: Conferencia {
                buffer: vk::Buffer::null(),
                memoria: vk::DeviceMemory::null(),
                ponteiro: std::ptr::null(),
            },
        };
        vulkan.conferencia = vulkan.criar_conferencia(vulkan.tamanho_quadro())?;
        vulkan.faixa = vulkan.criar_conferencia(u64::from(largura) * 4)?;
        Ok(vulkan)
    }

    fn tamanho_quadro(&self) -> u64 {
        u64::from(self.largura) * u64::from(self.altura) * 4
    }

    fn tipo_memoria(&self, bits: u32, exigidas: vk::MemoryPropertyFlags) -> Result<u32, String> {
        (0..self.propriedades.memory_type_count)
            .find(|&i| {
                bits & (1 << i) != 0
                    && self.propriedades.memory_types[i as usize]
                        .property_flags
                        .contains(exigidas)
            })
            .ok_or_else(|| format!("sem tipo de memória {exigidas:?} em {bits:#b}"))
    }

    fn criar_conferencia(&self, tamanho: u64) -> Result<Conferencia, String> {
        let d = &self.dispositivo;
        let buffer = unsafe {
            d.create_buffer(
                // TRANSFER_SRC: os testes também sobem o padrão por ele.
                &vk::BufferCreateInfo::default()
                    .size(tamanho)
                    .usage(vk::BufferUsageFlags::TRANSFER_DST | vk::BufferUsageFlags::TRANSFER_SRC),
                None,
            )
        }
        .map_err(erro("buffer de conferência"))?;
        let req = unsafe { d.get_buffer_memory_requirements(buffer) };
        let tipo = self.tipo_memoria(
            req.memory_type_bits,
            vk::MemoryPropertyFlags::HOST_VISIBLE | vk::MemoryPropertyFlags::HOST_COHERENT,
        )?;
        let memoria = unsafe {
            d.allocate_memory(
                &vk::MemoryAllocateInfo::default()
                    .allocation_size(req.size)
                    .memory_type_index(tipo),
                None,
            )
        }
        .map_err(erro("memória de conferência"))?;
        unsafe { d.bind_buffer_memory(buffer, memoria, 0) }.map_err(erro("bind conferência"))?;
        let ponteiro =
            unsafe { d.map_memory(memoria, 0, vk::WHOLE_SIZE, vk::MemoryMapFlags::empty()) }
                .map_err(erro("map conferência"))? as *const u8;
        Ok(Conferencia {
            buffer,
            memoria,
            ponteiro,
        })
    }

    /// Buffer na memória da placa, exportado como OPAQUE_FD para a CUDA. Devolve o índice e o fd.
    pub fn criar_exportavel(&mut self) -> Result<(usize, File, u64), String> {
        let d = &self.dispositivo;
        let mut externo = vk::ExternalMemoryBufferCreateInfo::default()
            .handle_types(vk::ExternalMemoryHandleTypeFlags::OPAQUE_FD);
        let buffer = unsafe {
            d.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(self.tamanho_quadro())
                    .usage(vk::BufferUsageFlags::TRANSFER_DST | vk::BufferUsageFlags::TRANSFER_SRC)
                    .push_next(&mut externo),
                None,
            )
        }
        .map_err(erro("buffer exportável"))?;
        let req = unsafe { d.get_buffer_memory_requirements(buffer) };
        let tipo =
            self.tipo_memoria(req.memory_type_bits, vk::MemoryPropertyFlags::DEVICE_LOCAL)?;
        let mut exportar = vk::ExportMemoryAllocateInfo::default()
            .handle_types(vk::ExternalMemoryHandleTypeFlags::OPAQUE_FD);
        let memoria = unsafe {
            d.allocate_memory(
                &vk::MemoryAllocateInfo::default()
                    .allocation_size(req.size)
                    .memory_type_index(tipo)
                    .push_next(&mut exportar),
                None,
            )
        }
        .map_err(erro("memória exportável"))?;
        unsafe { d.bind_buffer_memory(buffer, memoria, 0) }.map_err(erro("bind exportável"))?;
        let fd = unsafe {
            self.memoria_fd.get_memory_fd(
                &vk::MemoryGetFdInfoKHR::default()
                    .memory(memoria)
                    .handle_type(vk::ExternalMemoryHandleTypeFlags::OPAQUE_FD),
            )
        }
        .map_err(erro("vkGetMemoryFdKHR"))?;
        self.exportaveis.push(Exportavel {
            buffer,
            memoria,
            na_cuda: false,
        });
        Ok((
            self.exportaveis.len() - 1,
            unsafe { File::from_raw_fd(fd) },
            req.size,
        ))
    }

    fn importar(&mut self, quadro: &Quadro) -> Result<(vk::Image, bool), String> {
        // ManuallyDrop: o File só empresta o fd para o fstat, sem fechá-lo.
        let arquivo =
            std::mem::ManuallyDrop::new(unsafe { File::from_raw_fd(quadro.fd.as_raw_fd()) });
        let st = arquivo
            .metadata()
            .map_err(|e| format!("fstat do dma-buf: {e}"))?;
        let chave = (st.dev(), st.ino());
        if let Some(i) = self.importadas.get(&chave) {
            return Ok((i.imagem, false));
        }

        let d = &self.dispositivo;
        let planos = [vk::SubresourceLayout {
            offset: u64::from(quadro.offset),
            size: 0,
            row_pitch: u64::from(quadro.stride),
            array_pitch: 0,
            depth_pitch: 0,
        }];
        let mut modifier = vk::ImageDrmFormatModifierExplicitCreateInfoEXT::default()
            .drm_format_modifier(quadro.modifier)
            .plane_layouts(&planos);
        let mut externo = vk::ExternalMemoryImageCreateInfo::default()
            .handle_types(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT);
        let imagem = unsafe {
            d.create_image(
                &vk::ImageCreateInfo::default()
                    .image_type(vk::ImageType::TYPE_2D)
                    .format(FORMATO)
                    .extent(vk::Extent3D {
                        width: self.largura,
                        height: self.altura + self.marca,
                        depth: 1,
                    })
                    .mip_levels(1)
                    .array_layers(1)
                    .samples(vk::SampleCountFlags::TYPE_1)
                    .tiling(vk::ImageTiling::DRM_FORMAT_MODIFIER_EXT)
                    .usage(vk::ImageUsageFlags::TRANSFER_SRC)
                    .sharing_mode(vk::SharingMode::EXCLUSIVE)
                    .initial_layout(vk::ImageLayout::UNDEFINED)
                    .push_next(&mut externo)
                    .push_next(&mut modifier),
                None,
            )
        }
        .map_err(erro("VkImage do dma-buf"))?;

        let memoria = (|| -> Result<vk::DeviceMemory, String> {
            let mut props_fd = vk::MemoryFdPropertiesKHR::default();
            unsafe {
                self.memoria_fd.get_memory_fd_properties(
                    vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT,
                    quadro.fd.as_raw_fd(),
                    &mut props_fd,
                )
            }
            .map_err(erro("vkGetMemoryFdPropertiesKHR"))?;
            let req = unsafe { d.get_image_memory_requirements(imagem) };
            // O dma-buf precisa ter pelo menos o tamanho que a imagem exige; menor, a cópia leria fora dele.
            let tamanho_fd = unsafe { lseek(quadro.fd.as_raw_fd(), 0, 2) };
            if tamanho_fd >= 0 && (tamanho_fd as u64) < req.size {
                return Err(format!(
                    "dma-buf de {tamanho_fd} bytes, a imagem {}x{} pede {}",
                    self.largura, self.altura, req.size
                ));
            }
            let tipo = self.tipo_memoria(
                req.memory_type_bits & props_fd.memory_type_bits,
                vk::MemoryPropertyFlags::DEVICE_LOCAL,
            )?;
            if std::env::var_os("M02_DEPURAR").is_some() {
                let tipos: Vec<_> = (0..self.propriedades.memory_type_count)
                    .map(|i| (i, self.propriedades.memory_types[i as usize].property_flags))
                    .collect();
                eprintln!(
                    "importar: imagem {:#b} fd {:#b} escolhido {tipo} tamanho {} tipos {tipos:?}",
                    req.memory_type_bits, props_fd.memory_type_bits, req.size
                );
            }

            // Em caso de sucesso o Vulkan fica dono do fd duplicado; o original volta para o Chromium no release().
            let copia = quadro
                .fd
                .try_clone()
                .map_err(|e| format!("dup do fd: {e}"))?;
            let mut importar = vk::ImportMemoryFdInfoKHR::default()
                .handle_type(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT)
                .fd(copia.as_raw_fd());
            let mut dedicada = vk::MemoryDedicatedAllocateInfo::default().image(imagem);
            let memoria = unsafe {
                d.allocate_memory(
                    &vk::MemoryAllocateInfo::default()
                        .allocation_size(req.size)
                        .memory_type_index(tipo)
                        .push_next(&mut importar)
                        .push_next(&mut dedicada),
                    None,
                )
            }
            .map_err(erro("importar dma-buf"))?;
            let _ = copia.into_raw_fd();
            if let Err(e) = unsafe { d.bind_image_memory(imagem, memoria, 0) } {
                unsafe { d.free_memory(memoria, None) };
                return Err(format!("bind dma-buf: {e:?}"));
            }
            Ok(memoria)
        })()
        .inspect_err(|_| unsafe { d.destroy_image(imagem, None) })?;

        self.importadas.insert(chave, Importada { imagem, memoria });
        Ok((imagem, true))
    }

    /// Copia o quadro para o exportável `destino`, na placa. Com `conferir`, também lê o resultado para a CPU.
    /// Devolve se precisou importar o dma-buf e, com `conferir`, os pixels BGRA sem preenchimento.
    pub fn copiar(
        &mut self,
        quadro: &Quadro,
        destino: usize,
        conferir: bool,
    ) -> Result<(bool, Option<Vec<u8>>), String> {
        let (imagem, importou) = self.importar(quadro)?;
        // O compositor entrega o quadro com handle nativo sem esperar a placa terminar de desenhar
        // (skia_output_surface_impl_on_gpu.cc, CopyOutput): a cópia espera a cerca implícita do dma-buf.
        let sync = exportar_sync_file(quadro.fd.as_raw_fd());
        match &sync {
            Some(f) if pendente(f) => self.cercas_pendentes += 1,
            Some(_) => {}
            None => self.sem_sync_file += 1,
        }
        let d = &self.dispositivo;
        let c = self.comandos;
        let indice = destino;
        let destino = self.exportaveis[indice].buffer;
        let vinha_da_cuda = self.exportaveis[indice].na_cuda;
        let cor = vk::ImageSubresourceRange::default()
            .aspect_mask(vk::ImageAspectFlags::COLOR)
            .level_count(1)
            .layer_count(1);
        unsafe {
            d.begin_command_buffer(
                c,
                &vk::CommandBufferBeginInfo::default()
                    .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT),
            )
            .map_err(erro("begin"))?;
            // Recebe a imagem do Chromium (fila estrangeira) e a devolve depois da cópia.
            let adquirir = vk::ImageMemoryBarrier::default()
                .dst_access_mask(vk::AccessFlags::TRANSFER_READ)
                .old_layout(vk::ImageLayout::GENERAL)
                .new_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
                .src_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
                .dst_queue_family_index(self.familia)
                .image(imagem)
                .subresource_range(cor);
            d.cmd_pipeline_barrier(
                c,
                vk::PipelineStageFlags::TOP_OF_PIPE,
                vk::PipelineStageFlags::TRANSFER,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &[adquirir],
            );
            let regiao = vk::BufferImageCopy::default()
                .image_subresource(
                    vk::ImageSubresourceLayers::default()
                        .aspect_mask(vk::ImageAspectFlags::COLOR)
                        .layer_count(1),
                )
                .image_extent(vk::Extent3D {
                    width: self.largura,
                    height: self.altura,
                    depth: 1,
                });
            if vinha_da_cuda {
                let retomar = vk::BufferMemoryBarrier::default()
                    .dst_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .src_queue_family_index(vk::QUEUE_FAMILY_EXTERNAL)
                    .dst_queue_family_index(self.familia)
                    .buffer(destino)
                    .size(vk::WHOLE_SIZE);
                d.cmd_pipeline_barrier(
                    c,
                    vk::PipelineStageFlags::TOP_OF_PIPE,
                    vk::PipelineStageFlags::TRANSFER,
                    vk::DependencyFlags::empty(),
                    &[],
                    &[retomar],
                    &[],
                );
            }
            d.cmd_copy_image_to_buffer(
                c,
                imagem,
                vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
                destino,
                &[regiao],
            );
            if self.marca > 0 {
                // Uma linha do meio da faixa (largura × 4 bytes), para ler a marca na CPU; o quadro não vem.
                let linha = vk::BufferImageCopy::default()
                    .image_subresource(
                        vk::ImageSubresourceLayers::default()
                            .aspect_mask(vk::ImageAspectFlags::COLOR)
                            .layer_count(1),
                    )
                    .image_offset(vk::Offset3D {
                        x: 0,
                        y: (self.altura + self.marca / 2) as i32,
                        z: 0,
                    })
                    .image_extent(vk::Extent3D {
                        width: self.largura,
                        height: 1,
                        depth: 1,
                    });
                d.cmd_copy_image_to_buffer(
                    c,
                    imagem,
                    vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
                    self.faixa.buffer,
                    &[linha],
                );
                // Como na conferência: a cerca sozinha não torna a escrita visível para a CPU.
                let faixa_para_cpu = vk::BufferMemoryBarrier::default()
                    .src_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .dst_access_mask(vk::AccessFlags::HOST_READ)
                    .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .buffer(self.faixa.buffer)
                    .size(vk::WHOLE_SIZE);
                d.cmd_pipeline_barrier(
                    c,
                    vk::PipelineStageFlags::TRANSFER,
                    vk::PipelineStageFlags::HOST,
                    vk::DependencyFlags::empty(),
                    &[],
                    &[faixa_para_cpu],
                    &[],
                );
            }
            let devolver = vk::ImageMemoryBarrier::default()
                .src_access_mask(vk::AccessFlags::TRANSFER_READ)
                .old_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
                .new_layout(vk::ImageLayout::GENERAL)
                .src_queue_family_index(self.familia)
                .dst_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
                .image(imagem)
                .subresource_range(cor);
            d.cmd_pipeline_barrier(
                c,
                vk::PipelineStageFlags::TRANSFER,
                vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &[devolver],
            );
            if conferir {
                let escrita = vk::BufferMemoryBarrier::default()
                    .src_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .dst_access_mask(vk::AccessFlags::TRANSFER_READ)
                    .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .buffer(destino)
                    .size(vk::WHOLE_SIZE);
                d.cmd_pipeline_barrier(
                    c,
                    vk::PipelineStageFlags::TRANSFER,
                    vk::PipelineStageFlags::TRANSFER,
                    vk::DependencyFlags::empty(),
                    &[],
                    &[escrita],
                    &[],
                );
                d.cmd_copy_buffer(
                    c,
                    destino,
                    self.conferencia.buffer,
                    &[vk::BufferCopy::default().size(self.tamanho_quadro())],
                );
                // A cerca sozinha não torna a escrita visível para a CPU (especificação do Vulkan).
                let para_cpu = vk::BufferMemoryBarrier::default()
                    .src_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .dst_access_mask(vk::AccessFlags::HOST_READ)
                    .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .buffer(self.conferencia.buffer)
                    .size(vk::WHOLE_SIZE);
                d.cmd_pipeline_barrier(
                    c,
                    vk::PipelineStageFlags::TRANSFER,
                    vk::PipelineStageFlags::HOST,
                    vk::DependencyFlags::empty(),
                    &[],
                    &[para_cpu],
                    &[],
                );
            }
            // Entrega o buffer à CUDA (o NVENC lê dele) depois das cópias.
            let entregar = vk::BufferMemoryBarrier::default()
                .src_access_mask(vk::AccessFlags::TRANSFER_WRITE | vk::AccessFlags::TRANSFER_READ)
                .src_queue_family_index(self.familia)
                .dst_queue_family_index(vk::QUEUE_FAMILY_EXTERNAL)
                .buffer(destino)
                .size(vk::WHOLE_SIZE);
            d.cmd_pipeline_barrier(
                c,
                vk::PipelineStageFlags::TRANSFER,
                vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                vk::DependencyFlags::empty(),
                &[],
                &[entregar],
                &[],
            );
            d.end_command_buffer(c).map_err(erro("end"))?;
            let lista = [c];
            let esperas = [self.espera];
            let estagios = [vk::PipelineStageFlags::TRANSFER];
            let mut envio = vk::SubmitInfo::default().command_buffers(&lista);
            if let Some(f) = sync {
                // Importação temporária: o Vulkan fica dono do fd, e o semáforo volta ao normal depois da espera.
                self.semaforo_fd
                    .import_semaphore_fd(
                        &vk::ImportSemaphoreFdInfoKHR::default()
                            .semaphore(self.espera)
                            .flags(vk::SemaphoreImportFlags::TEMPORARY)
                            .handle_type(vk::ExternalSemaphoreHandleTypeFlags::SYNC_FD)
                            .fd(f.as_raw_fd()),
                    )
                    .map_err(erro("importar sync_file"))?;
                let _ = f.into_raw_fd();
                envio = envio
                    .wait_semaphores(&esperas)
                    .wait_dst_stage_mask(&estagios);
            }
            d.queue_submit(self.fila, &[envio], self.cerca)
                .map_err(erro("submit"))?;
            // Espera na CPU (sem gastar CPU): o Chromium só recebe o quadro de volta depois da cópia.
            d.wait_for_fences(&[self.cerca], true, u64::MAX)
                .map_err(erro("cerca"))?;
            d.reset_fences(&[self.cerca]).map_err(erro("reset cerca"))?;
        }
        self.exportaveis[indice].na_cuda = true;
        let pixels = conferir.then(|| unsafe {
            std::slice::from_raw_parts(self.conferencia.ponteiro, self.tamanho_quadro() as usize)
                .to_vec()
        });
        Ok((importou, pixels))
    }

    /// A linha da faixa copiada na última chamada de `copiar` (só com marca).
    pub fn faixa(&self) -> Option<&[u8]> {
        (self.marca > 0).then(|| unsafe {
            std::slice::from_raw_parts(self.faixa.ponteiro, self.largura as usize * 4)
        })
    }

    pub fn importacoes(&self) -> usize {
        self.importadas.len()
    }
}

impl Drop for Vulkan {
    fn drop(&mut self) {
        let d = &self.dispositivo;
        unsafe {
            let _ = d.device_wait_idle();
            for (_, i) in self.importadas.drain() {
                d.destroy_image(i.imagem, None);
                d.free_memory(i.memoria, None);
            }
            for e in self.exportaveis.drain(..) {
                d.destroy_buffer(e.buffer, None);
                d.free_memory(e.memoria, None);
            }
            for c in [&self.conferencia, &self.faixa] {
                d.destroy_buffer(c.buffer, None);
                d.free_memory(c.memoria, None);
            }
            d.destroy_fence(self.cerca, None);
            d.destroy_semaphore(self.espera, None);
            d.destroy_command_pool(self.pool, None);
            d.destroy_device(None);
            self.instancia.destroy_instance(None);
        }
    }
}

/// Cerca das escritas pendentes no dma-buf (DMA_BUF_IOCTL_EXPORT_SYNC_FILE com DMA_BUF_SYNC_READ, Linux 6.0+).
fn exportar_sync_file(fd: i32) -> Option<OwnedFd> {
    #[repr(C)]
    struct ExportarSyncFile {
        flags: u32,
        fd: i32,
    }
    let mut arg = ExportarSyncFile { flags: 1, fd: -1 };
    let r = unsafe { ioctl(fd, 0xC008_6202, &mut arg) };
    (r == 0 && arg.fd >= 0).then(|| unsafe { OwnedFd::from_raw_fd(arg.fd) })
}

fn pendente(sync: &OwnedFd) -> bool {
    #[repr(C)]
    struct PollFd {
        fd: i32,
        events: i16,
        revents: i16,
    }
    let mut p = PollFd {
        fd: sync.as_raw_fd(),
        events: 1,
        revents: 0,
    };
    unsafe { poll(&mut p as *mut PollFd as *mut std::ffi::c_void, 1, 0) == 0 }
}

unsafe extern "C" {
    fn lseek(fd: i32, offset: i64, whence: i32) -> i64;
    fn ioctl(fd: i32, request: u64, ...) -> i32;
    fn poll(fds: *mut std::ffi::c_void, n: u64, timeout: i32) -> i32;
}

#[cfg(test)]
pub(crate) mod testes {
    use super::*;

    const PADRAO: (u32, u32) = (100, 37);

    fn padrao() -> Vec<u8> {
        let (l, a) = PADRAO;
        (0..a)
            .flat_map(|y| {
                (0..l).flat_map(move |x| [x as u8, y as u8, (x + y) as u8, 255 - x as u8])
            })
            .collect()
    }

    /// Exporta o padrão num dma-buf com `modifier` por outro VkDevice e devolve o que o destino leu dele.
    fn ida_e_volta(modifier: u64, erro_no_stride: u32) -> (Vec<u8>, u32, usize) {
        let (l, a) = PADRAO;
        let fonte = Vulkan::new(l, a).expect("vulkan da fonte");
        let (fd, stride, offset) = exportar_dma_buf(&fonte, &padrao(), modifier);
        let mut destino = Vulkan::new(l, a).expect("vulkan do destino");
        let (indice, _, _) = destino.criar_exportavel().expect("exportável");
        let quadro = Quadro {
            fd,
            stride: stride + erro_no_stride,
            offset,
            modifier,
        };
        let (importou, pixels) = destino.copiar(&quadro, indice, true).expect("cópia");
        assert!(importou);
        // O mesmo dma-buf não é importado de novo.
        let (importou, _) = destino
            .copiar(&quadro, indice, false)
            .expect("segunda cópia");
        assert!(!importou);
        (pixels.expect("conferência"), stride, destino.importacoes())
    }

    /// Linear (`modifier` 0), como o Chromium entrega com buffer «mapeável».
    #[test]
    fn importa_dma_buf_linear_com_alfa() {
        let (pixels, stride, importacoes) = ida_e_volta(0, 0);
        assert!(stride >= PADRAO.0 * 4);
        assert!(pixels == padrao(), "pixels diferentes do padrão");
        assert_eq!(importacoes, 1);
    }

    /// O `modifier` não linear que o driver prefere, como o Chromium entrega com o handle nativo (M02).
    #[test]
    fn importa_dma_buf_block_linear_com_alfa() {
        let fonte = Vulkan::new(PADRAO.0, PADRAO.1).expect("vulkan");
        let modifier =
            modifier_nao_linear(&fonte).expect("o driver não anuncia modifier não linear");
        drop(fonte);
        let (pixels, _, _) = ida_e_volta(modifier, 0);
        assert!(
            pixels == padrao(),
            "pixels diferentes do padrão com modifier {modifier:#x}"
        );
    }

    /// Regressão do caso negativo: com o stride errado, a leitura não pode sair igual.
    #[test]
    fn stride_errado_nao_passa() {
        let (pixels, _, _) = ida_e_volta(0, 256);
        assert!(pixels != padrao());
    }

    fn modifier_nao_linear(v: &Vulkan) -> Option<u64> {
        let mut lista = vk::DrmFormatModifierPropertiesListEXT::default();
        let mut props = vk::FormatProperties2::default().push_next(&mut lista);
        unsafe {
            v.instancia
                .get_physical_device_format_properties2(v.fisico, FORMATO, &mut props)
        };
        let n = lista.drm_format_modifier_count as usize;
        let mut itens = vec![vk::DrmFormatModifierPropertiesEXT::default(); n];
        let mut lista = vk::DrmFormatModifierPropertiesListEXT::default()
            .drm_format_modifier_properties(&mut itens);
        let mut props = vk::FormatProperties2::default().push_next(&mut lista);
        unsafe {
            v.instancia
                .get_physical_device_format_properties2(v.fisico, FORMATO, &mut props)
        };
        let precisa = vk::FormatFeatureFlags::TRANSFER_SRC | vk::FormatFeatureFlags::TRANSFER_DST;
        itens
            .iter()
            .find(|m| {
                m.drm_format_modifier != 0
                    && m.drm_format_modifier_plane_count == 1
                    && m.drm_format_modifier_tiling_features.contains(precisa)
            })
            .map(|m| m.drm_format_modifier)
    }

    /// M03: imagem com a faixa da marca embaixo. Só as linhas de cima vão para o exportável (e a conferência),
    /// e a linha da faixa lida traz o número desenhado nela.
    #[test]
    fn separa_quadro_e_faixa_da_marca() {
        use crate::marca;
        let (l, a, m) = (816u32, 20u32, 16u32);
        let topo: Vec<u8> = (0..a)
            .flat_map(|y| (0..l).flat_map(move |x| [x as u8, y as u8, 7, 200]))
            .collect();
        let linha = marca::desenhar(12345, l as usize);
        let mut padrao = topo.clone();
        for _ in 0..m {
            padrao.extend_from_slice(&linha);
        }
        let fonte = Vulkan::new(l, a + m).expect("vulkan da fonte");
        let (fd, stride, offset) = exportar_dma_buf(&fonte, &padrao, 0);

        let mut destino = Vulkan::com_marca(l, a, m).expect("vulkan do destino");
        let (indice, _, _) = destino.criar_exportavel().expect("exportável");
        let (_, pixels) = destino
            .copiar(
                &Quadro {
                    fd,
                    stride,
                    offset,
                    modifier: 0,
                },
                indice,
                true,
            )
            .expect("cópia");
        assert!(
            pixels.expect("conferência") == topo,
            "a área codificada não pode levar a faixa"
        );
        assert_eq!(marca::ler(destino.faixa().expect("faixa")), Some(12345));
    }

    pub(crate) fn exportar_dma_buf(
        v: &Vulkan,
        padrao: &[u8],
        modifier: u64,
    ) -> (OwnedFd, u32, u32) {
        let d = &v.dispositivo;
        let modifiers = [modifier];
        let mut lista =
            vk::ImageDrmFormatModifierListCreateInfoEXT::default().drm_format_modifiers(&modifiers);
        let mut externo = vk::ExternalMemoryImageCreateInfo::default()
            .handle_types(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT);
        unsafe {
            let imagem = d
                .create_image(
                    &vk::ImageCreateInfo::default()
                        .image_type(vk::ImageType::TYPE_2D)
                        .format(FORMATO)
                        .extent(vk::Extent3D {
                            width: v.largura,
                            height: v.altura,
                            depth: 1,
                        })
                        .mip_levels(1)
                        .array_layers(1)
                        .samples(vk::SampleCountFlags::TYPE_1)
                        .tiling(vk::ImageTiling::DRM_FORMAT_MODIFIER_EXT)
                        .usage(vk::ImageUsageFlags::TRANSFER_DST)
                        .initial_layout(vk::ImageLayout::UNDEFINED)
                        .push_next(&mut externo)
                        .push_next(&mut lista),
                    None,
                )
                .expect("imagem exportável");
            let req = d.get_image_memory_requirements(imagem);
            let tipo = v
                .tipo_memoria(req.memory_type_bits, vk::MemoryPropertyFlags::DEVICE_LOCAL)
                .unwrap();
            let mut exportar = vk::ExportMemoryAllocateInfo::default()
                .handle_types(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT);
            let mut dedicada = vk::MemoryDedicatedAllocateInfo::default().image(imagem);
            let memoria = d
                .allocate_memory(
                    &vk::MemoryAllocateInfo::default()
                        .allocation_size(req.size)
                        .memory_type_index(tipo)
                        .push_next(&mut exportar)
                        .push_next(&mut dedicada),
                    None,
                )
                .expect("memória dma-buf");
            d.bind_image_memory(imagem, memoria, 0).unwrap();
            let layout = d.get_image_subresource_layout(
                imagem,
                vk::ImageSubresource::default()
                    .aspect_mask(vk::ImageAspectFlags::MEMORY_PLANE_0_EXT),
            );

            // O padrão sobe pelo buffer de conferência (visível pela CPU) e vai para a imagem.
            std::ptr::copy_nonoverlapping(
                padrao.as_ptr(),
                v.conferencia.ponteiro as *mut u8,
                padrao.len(),
            );
            let c = v.comandos;
            let cor = vk::ImageSubresourceRange::default()
                .aspect_mask(vk::ImageAspectFlags::COLOR)
                .level_count(1)
                .layer_count(1);
            d.begin_command_buffer(c, &vk::CommandBufferBeginInfo::default())
                .unwrap();
            let paraescrita = vk::ImageMemoryBarrier::default()
                .dst_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                .old_layout(vk::ImageLayout::UNDEFINED)
                .new_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .image(imagem)
                .subresource_range(cor);
            d.cmd_pipeline_barrier(
                c,
                vk::PipelineStageFlags::TOP_OF_PIPE,
                vk::PipelineStageFlags::TRANSFER,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &[paraescrita],
            );
            let regiao = vk::BufferImageCopy::default()
                .image_subresource(
                    vk::ImageSubresourceLayers::default()
                        .aspect_mask(vk::ImageAspectFlags::COLOR)
                        .layer_count(1),
                )
                .image_extent(vk::Extent3D {
                    width: v.largura,
                    height: v.altura,
                    depth: 1,
                });
            d.cmd_copy_buffer_to_image(
                c,
                v.conferencia.buffer,
                imagem,
                vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                &[regiao],
            );
            let entregar = vk::ImageMemoryBarrier::default()
                .src_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                .old_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                .new_layout(vk::ImageLayout::GENERAL)
                .src_queue_family_index(v.familia)
                .dst_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
                .image(imagem)
                .subresource_range(cor);
            d.cmd_pipeline_barrier(
                c,
                vk::PipelineStageFlags::TRANSFER,
                vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &[entregar],
            );
            d.end_command_buffer(c).unwrap();
            let cmds = [c];
            d.queue_submit(
                v.fila,
                &[vk::SubmitInfo::default().command_buffers(&cmds)],
                v.cerca,
            )
            .unwrap();
            d.wait_for_fences(&[v.cerca], true, u64::MAX).unwrap();
            d.reset_fences(&[v.cerca]).unwrap();

            let fd = v
                .memoria_fd
                .get_memory_fd(
                    &vk::MemoryGetFdInfoKHR::default()
                        .memory(memoria)
                        .handle_type(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT),
                )
                .expect("fd do dma-buf");
            // O dma-buf continua vivo pelo fd depois de a fonte soltar a imagem e a memória.
            d.destroy_image(imagem, None);
            d.free_memory(memoria, None);
            (
                OwnedFd::from_raw_fd(fd),
                layout.row_pitch as u32,
                layout.offset as u32,
            )
        }
    }
}

<script lang="ts">
  import { downloadUrl } from '$lib/utils';
  import { toastManager, Button, Modal, ModalBody, ModalFooter } from '@immich/ui';

  type ExportItem = {
    id: string;
    assetId: string;
    format: string;
    resolution: string | number;
    quality: number;
    status: 'queued' | 'processing' | 'ready' | 'failed';
    fileName: string | null;
    error: string | null;
  };
  type Props = { assetId: string; isVideo: boolean; onClose: () => void };
  const { assetId, isVideo, onClose }: Props = $props();
  let format = $state(isVideo ? 'mp4-h264' : 'jpeg');
  let resolution: 'original' | '1080' | '1440' | '2160' = $state('2160');
  let quality = $state(90);
  let submitting = $state(false);
  let exports = $state<ExportItem[]>([]);

  const load = async () => {
    const response = await fetch('/api/download/exports');
    if (response.ok) {
      const items = (await response.json()) as ExportItem[];
      exports = items.filter((item) => item.assetId === assetId);
    }
  };
  const create = async () => {
    submitting = true;
    try {
      const response = await fetch('/api/download/exports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId, format, resolution, quality }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      toastManager.primary('导出任务已加入队列');
      await load();
    } catch (error) {
      toastManager.danger(`创建导出任务失败: ${error}`);
    } finally {
      submitting = false;
    }
  };
  $effect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  });
</script>

<Modal title="转码导出" size="small" {onClose}>
  <ModalBody>
    <div class="flex flex-col gap-4">
      <label
        >格式<select class="immich-form-input w-full" bind:value={format}
          >{#if isVideo}<option value="mp4-h264">MP4 / H.264（兼容性最好）</option><option value="mp4-hevc"
              >MP4 / HEVC（体积更小）</option
            >{:else}<option value="jpeg">JPEG</option><option value="png">PNG</option><option value="webp">WebP</option
            >{/if}</select
        ></label
      >
      <label
        >分辨率<select class="immich-form-input w-full" bind:value={resolution}
          ><option value="original">原尺寸</option><option value="2160">4K</option><option value="1440"
            >2K / 1440p</option
          ><option value="1080">1080p</option></select
        ></label
      >
      <label>质量：{quality}<input class="w-full" type="range" min="1" max="100" bind:value={quality} /></label>
      {#if exports.length}<div class="flex flex-col gap-2">
          <h3 class="font-medium">已有任务</h3>
          {#each exports as item (item.id)}<div
              class="flex items-center justify-between gap-2 rounded-sm bg-gray-100 p-2 dark:bg-gray-800"
            >
              <span>{item.resolution} · {item.format} · {item.status}{item.error ? ` · ${item.error}` : ''}</span
              >{#if item.status === 'ready'}<Button
                  size="small"
                  onclick={() => downloadUrl(`/api/download/exports/${item.id}`, item.fileName ?? 'export')}
                  >下载</Button
                >{/if}
            </div>{/each}
        </div>{/if}
    </div>
  </ModalBody>
  <ModalFooter
    ><Button color="secondary" onclick={onClose}>关闭</Button><Button disabled={submitting} onclick={create}
      >加入队列</Button
    ></ModalFooter
  >
</Modal>

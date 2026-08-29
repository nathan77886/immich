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
  let resolution = $state<'original' | '1080' | '1440' | '2160' | '2880' | '3456' | '4032' | '4320'>('2160');
  let quality = $state(90);
  let submitting = $state(false);
  let exports = $state<ExportItem[]>([]);
  const formatNote = $derived(
    isVideo
      ? format === 'mp4-hevc'
        ? 'MP4 容器 + H.265/HEVC。文件通常更小，但旧设备和部分浏览器可能无法播放。'
        : 'MP4 容器 + H.264/AVC。兼容性最好，适合电脑、手机、电视和浏览器。'
      : format === 'png'
        ? '无损图片。适合截图、文字和后期处理，照片文件通常最大。'
        : format === 'webp'
          ? '现代高压缩图片。文件通常较小，但旧软件兼容性弱于 JPEG。'
          : '通用有损图片。照片兼容性最好，不保留 RAW 编辑能力。',
  );
  const resolutionNote = $derived(
    resolution === 'original'
      ? '保持原始宽高，不主动缩小；仍会按所选格式重新编码。'
      : resolution === '4320'
        ? '最大 7680×4320（8K），小于该尺寸时不会放大。'
        : resolution === '4032'
          ? '最大 7168×4032（7K），小于该尺寸时不会放大。'
          : resolution === '3456'
            ? '最大 6144×3456（6K），小于该尺寸时不会放大。'
            : resolution === '2880'
              ? '最大 5120×2880（5K），小于该尺寸时不会放大。'
              : resolution === '2160'
                ? '最长边限制为 3840×2160（4K），小于该尺寸时不会放大。'
                : resolution === '1440'
                  ? '最长边限制为 2560×1440（2K），小于该尺寸时不会放大。'
                  : '最长边限制为 1920×1080，小于该尺寸时不会放大。',
  );
  const qualityNote = $derived(
    isVideo
      ? `视频质量 ${quality}/100，对应约 CRF ${Math.max(13, Math.round(31 - quality * 0.18))}。数值越高越清晰、文件越大、转码越慢。`
      : `图片编码质量 ${quality}/100。数值越高越清晰、文件越大；PNG 为无损格式，此参数影响较小。`,
  );

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
      <p class="text-sm text-gray-600 dark:text-gray-300">{formatNote}</p>
      <ul class="list-disc space-y-1 ps-5 text-xs text-gray-500 dark:text-gray-400">
        {#if isVideo}
          <li>MP4 / H.264：兼容性最好，文件通常较大。</li>
          <li>MP4 / HEVC：压缩率更高，旧设备兼容性较弱。</li>
        {:else}
          <li>JPEG：照片兼容性最好，有损压缩，不支持透明。</li>
          <li>PNG：无损压缩，支持透明，照片文件通常最大。</li>
          <li>WebP：文件通常较小，支持透明，旧软件兼容性较弱。</li>
        {/if}
      </ul>
      <label
        >分辨率<select class="immich-form-input w-full" bind:value={resolution}
          ><option value="original">原尺寸</option><option value="4320">8K</option><option value="4032">7K</option
          ><option value="3456">6K</option><option value="2880">5K</option><option value="2160">4K</option><option
            value="1440">2K / 1440p</option
          ><option value="1080">1080p</option></select
        ></label
      >
      <p class="text-sm text-gray-600 dark:text-gray-300">{resolutionNote}</p>
      <ul class="list-disc space-y-1 ps-5 text-xs text-gray-500 dark:text-gray-400">
        <li>原尺寸：保持原始宽高，只转换格式和编码。</li>
        <li>8K：最大 7680×4320，为更高分辨率素材预留。</li>
        <li>7K：最大 7168×4032，适合 7K 相机素材。</li>
        <li>6K：最大 6144×3456，适合常见 6K 素材。</li>
        <li>5K：最大 5120×2880，兼顾高分辨率和文件体积。</li>
        <li>4K：最大 3840×2160，适合大屏播放和保存细节。</li>
        <li>2K / 1440p：最大 2560×1440，清晰度与体积较均衡。</li>
        <li>1080p：最大 1920×1080，兼容性高、文件较小。</li>
      </ul>
      <label>质量：{quality}<input class="w-full" type="range" min="1" max="100" step="1" bind:value={quality} /></label
      >
      <p class="text-sm text-gray-600 dark:text-gray-300">{qualityNote}</p>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        建议：普通分享 75–85；高质量保存 90–95；100 文件很大，通常看不出明显提升。
      </p>
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

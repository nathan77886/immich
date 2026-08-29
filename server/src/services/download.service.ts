import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { basename, dirname, extname, join, parse } from 'node:path';
import sanitize from 'sanitize-filename';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { DownloadArchiveDto, DownloadArchiveInfo, DownloadInfoDto, DownloadResponseDto } from 'src/dtos/download.dto';
import { ExportCreateDto, ExportResponseDto } from 'src/dtos/export.dto';
import { AssetType, CacheControl, JobName, JobStatus, Permission, QueueName, StorageFolder } from 'src/enum';
import { ImmichReadStream } from 'src/repositories/storage.repository';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { HumanReadableSize } from 'src/utils/bytes';
import { ImmichFileResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';
import { getPreferences } from 'src/utils/preferences';

@Injectable()
export class DownloadService extends BaseService {
  private exportPathSegment(value: string) {
    const segment = basename(value);
    if (segment !== value || !/^[A-Za-z0-9_-]+$/.test(segment)) {
      throw new BadRequestException('Invalid export path');
    }
    return segment;
  }
  private exportRoot(userId: string) {
    return join(StorageCore.getFolderLocation(StorageFolder.EncodedVideo, this.exportPathSegment(userId)), 'exports');
  }
  private exportManifest(userId: string, id: string) {
    return join(this.exportRoot(userId), `${this.exportPathSegment(id)}.json`);
  }
  private async readExport(userId: string, id: string): Promise<ExportResponseDto & { outputPath: string | null }> {
    try {
      return JSON.parse(await fs.readFile(this.exportManifest(userId, id), 'utf8'));
    } catch {
      throw new BadRequestException('Export not found');
    }
  }
  private async writeExport(userId: string, item: ExportResponseDto & { outputPath: string | null }) {
    const path = this.exportManifest(userId, item.id);
    this.storageRepository.mkdirSync(dirname(path));
    const temporaryPath = `${path}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(item));
    await fs.rename(temporaryPath, path);
  }
  async createExport(auth: AuthDto, dto: ExportCreateDto): Promise<ExportResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: [dto.assetId] });
    const asset = await this.assetRepository.getById(dto.assetId);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }
    if ((asset.type === AssetType.Video) !== dto.format.startsWith('mp4-')) {
      throw new BadRequestException('Format does not match asset type');
    }
    const now = new Date().toISOString();
    const item = {
      ...dto,
      id: randomUUID(),
      status: 'queued' as const,
      fileName: null,
      outputPath: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeExport(auth.user.id, item);
    await this.jobRepository.queue({ name: JobName.AssetExport, data: { exportId: item.id, userId: auth.user.id } });
    return item;
  }
  async listExports(auth: AuthDto): Promise<ExportResponseDto[]> {
    // ponytail: per-export manifests support single shared media storage; migrate to DB when server-side filtering or retention automation is needed.
    try {
      const entries = await fs.readdir(this.exportRoot(auth.user.id));
      const files = entries.filter((x) => x.endsWith('.json'));
      const items = await Promise.all(files.map((x) => this.readExport(auth.user.id, basename(x, '.json'))));
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
  async downloadExport(auth: AuthDto, id: string) {
    const item = await this.readExport(auth.user.id, id);
    if (item.status !== 'ready' || !item.outputPath || !item.fileName) {
      throw new BadRequestException('Export is not ready');
    }
    return new ImmichFileResponse({
      path: item.outputPath,
      fileName: item.fileName,
      contentType: mimeTypes.lookup(item.outputPath),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  @OnJob({ name: JobName.AssetExport, queue: QueueName.VideoConversion })
  async handleExport({ exportId, userId }: JobOf<JobName.AssetExport>): Promise<JobStatus> {
    const item = await this.readExport(userId, exportId);
    item.status = 'processing';
    item.updatedAt = new Date().toISOString();
    await this.writeExport(userId, item);
    try {
      const asset = await this.assetRepository.getById(item.assetId);
      if (!asset) {
        throw new Error('Asset not found');
      }
      const suffix = item.format.startsWith('mp4-') ? 'mp4' : item.format;
      const stem = sanitize(basename(asset.originalFileName, extname(asset.originalFileName))) || asset.id;
      item.fileName = `${stem}-${item.resolution}-${item.format}.${suffix}`;
      item.outputPath = join(this.exportRoot(userId), exportId, item.fileName);
      this.storageRepository.mkdirSync(dirname(item.outputPath));
      if (item.format.startsWith('mp4-')) {
        await this.mediaRepository.exportVideo(asset.originalPath, item.outputPath, {
          codec: item.format === 'mp4-hevc' ? 'hevc' : 'h264',
          resolution: item.resolution,
          crf: Math.max(13, Math.round(31 - item.quality * 0.18)),
        });
      } else {
        const options = {
          format: item.format as 'jpeg' | 'png' | 'webp',
          resolution: item.resolution,
          quality: item.quality,
        };
        try {
          await this.mediaRepository.exportImage(asset.originalPath, item.outputPath, options);
        } catch (error) {
          const extracted = await this.mediaRepository.extract(asset.originalPath);
          if (!extracted) {
            throw error;
          }
          await this.mediaRepository.exportImage(extracted.buffer, item.outputPath, options);
        }
      }
      item.status = 'ready';
      return JobStatus.Success;
    } catch (error: any) {
      item.status = 'failed';
      item.error = error?.message ?? 'Export failed';
      return JobStatus.Failed;
    } finally {
      item.updatedAt = new Date().toISOString();
      await this.writeExport(userId, item);
    }
  }
  async getDownloadInfo(auth: AuthDto, dto: DownloadInfoDto): Promise<DownloadResponseDto> {
    let assets;

    if (dto.assetIds) {
      const assetIds = dto.assetIds;
      await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: assetIds });
      assets = this.downloadRepository.downloadAssetIds(assetIds);
    } else if (dto.albumId) {
      const albumId = dto.albumId;
      await this.requireAccess({ auth, permission: Permission.AlbumDownload, ids: [albumId] });
      assets = this.downloadRepository.downloadAlbumId(albumId);
    } else if (dto.userId) {
      const userId = dto.userId;
      await this.requireAccess({ auth, permission: Permission.TimelineDownload, ids: [userId] });
      assets = this.downloadRepository.downloadUserId(userId);
    } else {
      throw new BadRequestException('assetIds, albumId, or userId is required');
    }

    const targetSize = dto.archiveSize || HumanReadableSize.GiB * 4;
    const metadata = await this.userRepository.getMetadata(auth.user.id);
    const preferences = getPreferences(metadata);
    const motionIds = new Set<string>();
    const archives: DownloadArchiveInfo[] = [];
    let archive: DownloadArchiveInfo = { size: 0, assetIds: [] };

    const addToArchive = ({ id, size }: { id: string; size: number | null }) => {
      archive.assetIds.push(id);
      archive.size += Number(size || 0);

      if (archive.size > targetSize) {
        archives.push(archive);
        archive = { size: 0, assetIds: [] };
      }
    };

    for await (const asset of assets) {
      // motion part of live photos
      if (asset.livePhotoVideoId) {
        motionIds.add(asset.livePhotoVideoId);
      }

      addToArchive(asset);
    }

    if (motionIds.size > 0) {
      const motionAssets = this.downloadRepository.downloadMotionAssetIds([...motionIds]);
      for await (const motionAsset of motionAssets) {
        if (StorageCore.isAndroidMotionPath(motionAsset.originalPath) && !preferences.download.includeEmbeddedVideos) {
          continue;
        }

        addToArchive(motionAsset);
      }
    }

    if (archive.assetIds.length > 0) {
      archives.push(archive);
    }

    let totalSize = 0;
    for (const archive of archives) {
      totalSize += archive.size;
    }

    return { totalSize, archives };
  }

  async downloadArchive(auth: AuthDto, dto: DownloadArchiveDto): Promise<ImmichReadStream> {
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: dto.assetIds });

    const zip = this.storageRepository.createZipStream();
    const assets = await this.assetRepository.getForOriginals(dto.assetIds, dto.edited ?? false);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const paths: Record<string, number> = {};

    for (const assetId of dto.assetIds) {
      const asset = assetMap.get(assetId);
      if (!asset) {
        continue;
      }

      const { originalPath, editedPath, originalFileName } = asset;

      let filename = sanitize(originalFileName) || 'unnamed';
      const count = paths[filename] || 0;
      paths[filename] = count + 1;
      if (count !== 0) {
        const parsedFilename = parse(filename);
        filename = `${parsedFilename.name}+${count}${parsedFilename.ext}`;
      }

      let realpath = dto.edited && editedPath ? editedPath : originalPath;

      try {
        realpath = await this.storageRepository.realpath(realpath);
      } catch {
        this.logger.warn('Unable to resolve realpath', { originalPath });
      }

      zip.addFile(realpath, filename);
    }

    void zip.finalize();

    return {
      stream: zip.stream,
      disposition: dto.archiveName && `attachment; filename*=UTF-8''${encodeURIComponent(dto.archiveName)}.zip`,
    };
  }
}

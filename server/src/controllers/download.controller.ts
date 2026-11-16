import { Body, Controller, Get, HttpCode, HttpStatus, Next, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { DownloadArchiveDto, DownloadInfoDto, DownloadResponseDto } from 'src/dtos/download.dto.js';
import { ExportCreateDto, ExportResponseDto } from 'src/dtos/export.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DownloadService } from 'src/services/download.service.js';
import { asStreamableFile, sendFile } from 'src/utils/file.js';
import { UUIDParamDto } from 'src/validation.js';

@ApiTags(ApiTag.Download)
@Controller('download')
export class DownloadController {
  constructor(
    private service: DownloadService,
    private logger: LoggingRepository,
  ) {}

  @Post('info')
  @Authenticated({ permission: Permission.AssetDownload, sharedLink: true })
  @Endpoint({
    summary: 'Retrieve download information',
    description:
      'Retrieve information about how to request a download for the specified assets or album. The response includes groups of assets that can be downloaded together.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getDownloadInfo(@Auth() auth: AuthDto, @Body() dto: DownloadInfoDto): Promise<DownloadResponseDto> {
    return this.service.getDownloadInfo(auth, dto);
  }

  @Post('archive')
  @Authenticated({ permission: Permission.AssetDownload, sharedLink: true })
  @FileResponse()
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Download asset archive',
    description:
      'Download a ZIP archive containing the specified assets. The assets must have been previously requested via the "getDownloadInfo" endpoint.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  downloadArchive(@Auth() auth: AuthDto, @Body() dto: DownloadArchiveDto): Promise<StreamableFile> {
    return this.service.downloadArchive(auth, dto).then(asStreamableFile);
  }

  @Post('exports')
  @Authenticated({ permission: Permission.AssetDownload })
  createExport(@Auth() auth: AuthDto, @Body() dto: ExportCreateDto): Promise<ExportResponseDto> {
    return this.service.createExport(auth, dto);
  }

  @Get('exports')
  @Authenticated()
  listExports(@Auth() auth: AuthDto): Promise<ExportResponseDto[]> {
    return this.service.listExports(auth);
  }

  @Get('exports/:id')
  @Authenticated()
  @FileResponse()
  async downloadExport(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    await sendFile(res, next, () => this.service.downloadExport(auth, id), this.logger);
  }
}

import { NestFactory } from '@nestjs/core';
import Ffmpeg from 'fluent-ffmpeg';
import { WorkerModule } from './worker.module';

Ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg');
Ffmpeg.setFfprobePath(process.env.FFPROBE_PATH ?? '/usr/bin/ffprobe');

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
}

void bootstrap();

import { IsString, IsNotEmpty } from 'class-validator';

export class AbortUploadDto {
  @IsString()
  @IsNotEmpty()
  uploadId: string;
}

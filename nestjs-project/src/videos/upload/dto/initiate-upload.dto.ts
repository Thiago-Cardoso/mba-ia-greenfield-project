import {
  IsString,
  IsUUID,
  IsNumber,
  IsInt,
  Max,
  MaxLength,
  Matches,
  IsPositive,
} from 'class-validator';

export class InitiateUploadDto {
  @IsUUID()
  channelId: string;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsNumber()
  @IsInt()
  @IsPositive()
  @Max(10_737_418_240)
  fileSize: number;

  @IsString()
  @Matches(/^video\//)
  contentType: string;
}

import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  Min,
} from 'class-validator';

export class PresignedPartsDto {
  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}

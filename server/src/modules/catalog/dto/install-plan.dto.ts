import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

export class SelectionDto {
  @ApiProperty({ example: 'node' })
  @IsString()
  toolId!: string;

  @ApiProperty({ example: 'node-24.20.0' })
  @IsString()
  versionId!: string;
}

export class InstallPlanDto {
  @ApiProperty({ enum: ['windows', 'macos', 'linux'] })
  @IsIn(['windows', 'macos', 'linux'])
  platform!: 'windows' | 'macos' | 'linux';

  @ApiProperty({ enum: ['x64', 'arm64'] })
  @IsIn(['x64', 'arm64'])
  architecture!: 'x64' | 'arm64';

  @ApiProperty({ type: [String], example: ['winget', 'volta', 'npm'] })
  @IsArray()
  @IsIn(['winget', 'scoop', 'choco', 'brew', 'apt', 'volta', 'npm', 'official'], { each: true })
  preferredManagers!: Array<'winget' | 'scoop' | 'choco' | 'brew' | 'apt' | 'volta' | 'npm' | 'official'>;

  @ApiProperty({ type: [SelectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectionDto)
  selections!: SelectionDto[];
}

export class RecommendationDto {
  @ApiProperty({ enum: ['frontend', 'backend', 'fullstack', 'mobile', 'data-science', 'custom'] })
  @IsIn(['frontend', 'backend', 'fullstack', 'mobile', 'data-science', 'custom'])
  scenario!: 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'data-science' | 'custom';

  @ApiProperty({ required: false, enum: ['windows', 'macos', 'linux'] })
  @IsOptional()
  @IsIn(['windows', 'macos', 'linux'])
  platform?: 'windows' | 'macos' | 'linux';

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedToolIds?: string[];
}

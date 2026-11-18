import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { Gender } from "../../common/const/constant.js";

export class CreatePatientDto {
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @IsString()
  fullName: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // Lễ tân gửi confirmDuplicate = true sau khi đã xem cảnh báo trùng hồ sơ 
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}

export class UpdatePatientDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Role } from "./roles.entity.js";
import { UserStatus } from "../../common/const/constant.js";

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 20 })
  phone: string;

  @Column({ type: 'varchar', select: false, length: 255 })
  password_hash: string;

  @Column({ type: 'int' })
  role_id: number;

  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'boolean', default: false })
  must_change_password: boolean;

  @Column({ type: 'datetime', nullable: true })
  temp_password_expires_at: Date | null;

  @Column({ type: 'int', default: 0 })
  failed_login_count: number;

  @Column({ type: 'datetime', nullable: true })
  locked_until: Date | null;

  @Column({ type: 'int', default: 1 })
  token_version: number;

  @Column({ type: 'datetime', nullable: true })
  last_login_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";
import { AuditAction } from "../../common/const/constant.js";


@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'int', nullable: true })
  actor_user_id: number | null;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ type: 'varchar', length: 50 })
  target_type: string;

  @Column({ type: 'int' })
  target_id: number;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: 'varchar', nullable: true, length: 45 })
  ip: string | null;

  @CreateDateColumn()
  created_at: Date;
}
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Queue } from "./queues.entity.js";
import { QueueEventType } from "../../common/const/constant.js";

@Entity('queue_events')
export class QueueEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'int' })
  queue_id: number;

  @ManyToOne(() => Queue)
  @JoinColumn({ name: 'queue_id' })
  queue: Queue;

  @Column({ type: 'int', nullable: true })
  performed_by_user_id: number | null;

  @Column({ type: 'enum', enum: QueueEventType })
  event_type: QueueEventType;

  @Column({ type: 'varchar', nullable: true, length: 20 })
  from_status: string | null;

  @Column({ type: 'varchar', nullable: true, length: 20 })
  to_status: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;
}
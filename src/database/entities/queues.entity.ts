import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Patient } from "./patients.entity.js";
import { Doctor } from "./doctors.entity.js";
import { Room } from "./rooms.entity.js";
import { QueuePriority, QueueSource, QueueStatus } from "../../common/const/constant.js";

@Entity('queues')
export class Queue {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  patient_id: number;

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  @Column({ type: 'int', nullable: true })
  doctor_id: number | null;

  @ManyToOne(() => Doctor, { nullable: true })
  @JoinColumn({ name: 'doctor_id' })
  doctor: Doctor | null;

  @Column({ type: 'int' })
  room_id: number;

  @ManyToOne(() => Room)
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ type: 'int', nullable: true })
  created_by_user_id: number | null;

  @Column({ type: 'date' })
  queue_date: string;

  @Column({ type: 'int' })
  queue_sequence: number;

  @Column({ type: 'varchar', length: 8 })
  queue_number: string;

  @Column({ type: 'enum', enum: QueuePriority, default: QueuePriority.NORMAL })
  priority: QueuePriority;

  @Column({ type: 'tinyint', default: 0 })
  priority_rank: number;

  @Column({ type: 'enum', enum: QueueStatus, default: QueueStatus.WAITING })
  status: QueueStatus;

  @Column({ type: 'enum', enum: QueueSource })
  source: QueueSource;

  @Column({ type: 'int', default: 0 })
  skip_count: number;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  cancel_reason: string | null;

  @Column({ type: 'datetime', nullable: true })
  called_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  started_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  skipped_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  cancelled_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
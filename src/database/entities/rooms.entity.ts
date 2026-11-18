import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { RoomStatus } from "../../common/const/constant.js";

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 30 })
  room_code: string;

  @Column({ type: 'varchar', length: 150 })
  room_name: string;

  @Column({ type: 'varchar', unique: true, length: 5 })
  queue_prefix: string;

  @Column({ type: 'enum', enum: RoomStatus, default: RoomStatus.ACTIVE })
  status: RoomStatus;

  @Column({ type: 'time', default: '07:00:00' })
  open_time: string;

  @Column({ type: 'time', default: '17:30:00' })
  close_time: string;

  @Column({ type: 'int', nullable: true, default: 200 })
  max_daily_tickets: number | null;

  @Column({ type: 'int', default: 5 })
  call_timeout_minutes: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
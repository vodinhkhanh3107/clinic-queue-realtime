import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity('queue_counters')
export class QueueCounter {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  room_id: number;

  @Column({ type: 'date' })
  queue_date: string;

  @Column({ type: 'int', default: 0 })
  last_number: number;

  @Column({ type: 'int', default: 0 })
  priority_streak: number;

  @UpdateDateColumn()
  updated_at: Date;
}
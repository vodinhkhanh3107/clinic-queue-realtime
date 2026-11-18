import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Doctor } from "./doctors.entity.js";
import { Room } from "./rooms.entity.js";

@Entity('doctor_room_assignments')
export class DoctorRoomAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  doctor_id: number;

  @ManyToOne(() => Doctor)
  @JoinColumn({ name: 'doctor_id' })
  doctor: Doctor;

  @Column({ type: 'int' })
  room_id: number;

  @ManyToOne(() => Room)
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @CreateDateColumn()
  assigned_at: Date;

  @Column({ type: 'datetime', nullable: true })
  unassigned_at: Date | null;
}
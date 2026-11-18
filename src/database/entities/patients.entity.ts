import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { User } from "./users.entity.js";
import { Gender } from "../../common/const/constant.js";

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true, unique: true })
  user_id: number | null;

  @OneToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'varchar', unique: true, length: 30 })
  patient_code: string;

  @Column({ type: 'varchar', length: 150 })
  full_name: string;

  @Column({ type: 'date', nullable: true })
  date_of_birth: string | null;

  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender: Gender | null;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  address: string | null;

  @Column({ type: 'varchar', nullable: true, length: 20 })
  phone: string | null;

  @Column({ type: 'int' })
  created_by_user_id: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_user_id' })
  created_by: User;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
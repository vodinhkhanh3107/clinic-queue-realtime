import { AuditLog } from "./audit-logs.entity.js";
import { DoctorRoomAssignment } from "./doctor-room-assignments.entity.js";
import { Doctor } from "./doctors.entity.js";
import { Patient } from "./patients.entity.js";
import { Permission } from "./permissions.entity.js";
import { QueueCounter } from "./queue-counters.entity.js";
import { QueueEvent } from "./queue-events.entity.js";
import { Queue } from "./queues.entity.js";
import { Receptionist } from "./receptionists.entity.js";
import { Role } from "./roles.entity.js";
import { Room } from "./rooms.entity.js";
import { User } from "./users.entity.js";

export const ALL_ENTITIES = {
  Permission,
  Role,
  User,
  Patient,
  Doctor,
  Receptionist,
  Room,
  DoctorRoomAssignment,
  Queue,
  QueueEvent,
  QueueCounter,
  AuditLog,
};
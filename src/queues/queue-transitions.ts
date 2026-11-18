import { QueueEventType, QueueStatus } from "../common/const/constant.js";

export type QueueAction =
  | 'CALL_SPECIFIC'
  | 'RECALL'
  | 'START'
  | 'COMPLETE'
  | 'SKIP'
  | 'CANCEL';

export interface TransitionRule {
  from: QueueStatus[];
  to: QueueStatus;
  event: QueueEventType;
  permission?: string[];
}

export const QUEUE_TRANSITIONS: Record<QueueAction, TransitionRule> = {
  // Gọi đích danh queue SKIPPED (skip_count < 3)
  CALL_SPECIFIC: {
    from: [QueueStatus.SKIPPED],
    to: QueueStatus.CALLED,
    event: QueueEventType.CALLED,
    permission: ['queue.call'],
  },
  // Gọi lại: giữ trạng thái CALLED, phát event RECALLED
  RECALL: {
    from: [QueueStatus.CALLED],
    to: QueueStatus.CALLED,
    event: QueueEventType.RECALLED,
    permission: ['queue.recall'],
  },
  // Bắt đầu khám: CALLED -> IN_PROGRESS (event STARTED)
  START: {
    from: [QueueStatus.CALLED],
    to: QueueStatus.IN_PROGRESS,
    event: QueueEventType.STARTED,
    permission: ['queue.start'],
  },
  // Hoàn thành khám: IN_PROGRESS -> COMPLETED
  COMPLETE: {
    from: [QueueStatus.IN_PROGRESS],
    to: QueueStatus.COMPLETED,
    event: QueueEventType.COMPLETED,
    permission: ['queue.complete'],
  },
  // Bỏ qua lượt khám: CALLED -> SKIPPED (nếu skip lần thứ 3 sẽ tự chuyển sang CANCELLED NO_SHOW)
  SKIP: {
    from: [QueueStatus.CALLED],
    to: QueueStatus.SKIPPED,
    event: QueueEventType.SKIPPED,
    permission: ['queue.skip'],
  },
  // Hủy lượt khám: chỉ hủy khi WAITING
  CANCEL: {
    from: [QueueStatus.WAITING],
    to: QueueStatus.CANCELLED,
    event: QueueEventType.CANCELLED,
    permission: ['queue.cancel', 'queue.cancel.self'],
  },
};

export const PRIORITY_RANK_MAP: Record<string, number> = {
  NORMAL: 0,
  PRIORITY: 1,
  URGENT: 2,
};
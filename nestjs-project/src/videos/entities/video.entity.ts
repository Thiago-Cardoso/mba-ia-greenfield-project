import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

@Entity('videos')
@Index(['channel_id'])
@Index(['status'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'varchar', length: 11, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  upload_id: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  storage_key: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'float', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('ai_explanations')
export class AiExplanation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'login_id', type: 'uuid', unique: true })
  loginId!: string;

  @Column({ name: 'explanation_text', type: 'text' })
  explanationText!: string;

  @Column({ name: 'recommended_action', type: 'text' })
  recommendedAction!: string;

  @CreateDateColumn({ name: 'generated_at' })
  generatedAt!: Date;
}

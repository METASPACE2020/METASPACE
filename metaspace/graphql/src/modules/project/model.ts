import {
  Entity,
  PrimaryColumn,
  Column,
  JoinColumn,
  OneToMany,
  ManyToOne,
  Index,
  Unique,
} from 'typeorm';

import {User} from '../user/model';
import {UserProjectRole, PublicationStatus} from '../../binding'
import {DatasetProject} from '../dataset/model';
import {Moment} from 'moment';
import {MomentValueTransformer} from '../../utils/MomentValueTransformer';
import {PublicationStatusOptions as PSO} from './PublicationStatusOptions';
import {ELPO, ExternalLinkProvider} from './ExternalLinkProvider';

export const UserProjectRoleOptions: Record<UserProjectRole, UserProjectRole> = {
  INVITED: 'INVITED',
  PENDING: 'PENDING',
  MEMBER: 'MEMBER',
  MANAGER: 'MANAGER',
  REVIEWER: 'REVIEWER',
};

@Entity()
export class Project {

  @PrimaryColumn({ type: 'uuid', default: () => 'uuid_generate_v1mc()' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  urlSlug: string | null;

  @OneToMany(type => UserProject, userProject => userProject.project)
  members: UserProject[];

  @Column({ name: 'is_public', type: 'boolean', default: true })
  isPublic: boolean;

  @OneToMany(type => DatasetProject, datasetProject => datasetProject.project)
  datasetProjects: DatasetProject[];

  @Column({ name: 'created_dt', type: 'timestamp without time zone', default: () => "(now() at time zone 'utc')",
    transformer: new MomentValueTransformer() })
  createdDT: Moment;

  @Column({ type: 'text', name: 'project_description', default: '' })
  projectDescriptionAsHtml: string;

  @Column({ type: 'text', nullable: true })
  reviewToken: string | null;

  @Column({ type: 'timestamp without time zone', default: null, transformer: new MomentValueTransformer() })
  reviewTokenCreatedDT: Moment | null;

  @Column({ type: 'int', default: 0 })
  publishNotificationsSent: number;

  @Column({ type: 'text', enum: Object.keys(PSO), default: PSO.UNPUBLISHED })
  publicationStatus: PublicationStatus;

  @OneToMany(type => ProjectExternalLink, extLink => extLink.project)
  externalLinks: ProjectExternalLink[];
}

@Entity('user_project')
export class UserProject {

  @PrimaryColumn({ type: 'text' })
  userId: string;

  @ManyToOne(type => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @PrimaryColumn({ type: 'text' })
  projectId: string;

  @ManyToOne(type => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'text', enum: Object.keys(UserProjectRoleOptions) })
  role: UserProjectRole;
}

@Entity({ name: 'project_ext_link' })
@Unique(['projectId', 'provider', 'link'])
export class ProjectExternalLink {

  @PrimaryColumn({ type: 'uuid', default: () => 'uuid_generate_v1mc()' })
  id: string;

  @Column({ type: 'text' })
  projectId: string;

  @ManyToOne(type => Project, {onDelete: 'CASCADE'})
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'text', enum: Object.keys(ELPO) })
  provider: ExternalLinkProvider;

  @Column({ type: 'text' })
  link: string;
}

export const PROJECT_ENTITIES = [
  Project,
  UserProject,
  ProjectExternalLink,
];

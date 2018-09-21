import {Entity, PrimaryColumn, Column, OneToOne, JoinColumn, OneToMany, ManyToOne} from 'typeorm';
import {Credentials} from '../auth/model';
import {UserGroup, Group} from '../group/model';
import {Dataset} from '../dataset/model';

@Entity()
export class User {

  @PrimaryColumn({ type: 'uuid', default: () => 'uuid_generate_v1mc()' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text', default: 'user' })
  role: string;

  @Column({ type: 'text', name: 'credentials_id' })
  credentialsId: string;

  @OneToOne(type => Credentials)
  @JoinColumn({ name: 'credentials_id' })
  credentials: Credentials;

  @OneToMany(type => Dataset, ds => ds.user)
  datasets: Dataset[];

  @OneToMany(type => UserGroup, userGroup => userGroup.user)
  groups?: UserGroup[];
}

import 'reflect-metadata';
import * as _ from 'lodash';
import {
  createConnection as createTypeORMConnection,
  ConnectionOptions, Connection, EntityManager,
} from 'typeorm';

import config from './config';
import {Credentials} from '../modules/auth/model';
import {User as UserModel, User} from '../modules/user/model';
import {Dataset, DatasetProject} from '../modules/dataset/model';
import {Group, UserGroup} from '../modules/group/model';
import {Project, UserProject as UserProjectModel, UserProject} from '../modules/project/model';
import {UserProjectRoles} from '../context';

export const DbSchemaName = 'graphql';

const defaultDBConfig: ConnectionOptions = {
  type: 'postgres',
  host: config.db.host,
  database: config.db.database,
  username: config.db.user,
  password: config.db.password,
  schema: DbSchemaName,
  entities: [
    Credentials,
    User,
    Dataset,
    DatasetProject,
    Group,
    UserGroup,
    Project,
    UserProject,
  ],
  synchronize: true,
  logging: ['error','warn','info','log']
};

export const createConnection = async () => {
  return await createTypeORMConnection({
    ...defaultDBConfig
  });
};

export const findUserByEmail = async (connection: Connection | EntityManager, value: string, field: string='email') => {
  return await connection.getRepository(UserModel)
    .createQueryBuilder('user')
    .leftJoinAndSelect('user.credentials', 'credentials')
    .where(`LOWER(${field}) = :email`, { email: value.toLowerCase() })
    .getOne() || null;
};

export const getUserProjectRoles = async (connection: Connection | EntityManager, userId: string) => {
  const userProjects = await connection.getRepository(UserProjectModel)
    .find({ where: { userId } });
  return _.fromPairs(userProjects.map(up => [up.projectId, up.role]));
};

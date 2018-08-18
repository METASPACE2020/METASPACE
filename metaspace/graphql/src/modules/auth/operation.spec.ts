import * as uuid from 'uuid'
import * as Knex from 'knex'
import {Connection, getRepository} from 'typeorm'

import config from '../../utils/config';
import {createExpiry} from "./operation";
import {createConnection, DbSchemaName} from '../../utils/db'
import {
  createUserCredentials,
  verifyEmail,
  resetPassword,
  sendResetPasswordToken,
  verifyPassword,
  initOperation,
} from './operation'
import {Credentials} from './model';
import {User} from '../user/model';

jest.mock('./email');
import * as _mockEmail from './email';
const mockEmail = _mockEmail as jest.Mocked<typeof _mockEmail>;

async function createUserCredentialsEntities(connection: Connection, user?: Object, cred?: Object) {
  const defaultCred = {
    hash: 'some hash',
    emailVerificationToken: 'abc',
    emailVerificationTokenExpires: createExpiry(1),
    resetPasswordToken: null,
  };
  const updCred = {
    ...defaultCred,
    ...cred
  } as Credentials;
  await connection.manager.insert(Credentials, updCred);

  const defaultUser = {
    email: 'admin@localhost',
    name: 'Name',
  };
  const updUser = {
    ...defaultUser,
    ...user,
    credentials: updCred
  } as User;
  await connection.manager.insert(User, updUser);

  return {
    user: updUser,
    cred: updCred
  };
}

describe('Database operations with user', () => {
  let knexAdmin: Knex;
  let knex: Knex;
  let typeormConn: Connection;
  let UUID: string;

  beforeAll(async () => {
    console.log('> beforeAll');

    knexAdmin = Knex({
      client: 'postgres',
      connection: {
        host     : config.db.host,
        user     : 'postgres',
        database : 'postgres'
      },
      debug: false
    });
    await knexAdmin.raw(`DROP DATABASE IF EXISTS ${config.db.database};`);
    await knexAdmin.raw(`CREATE DATABASE ${config.db.database} OWNER ${config.db.user}`);

    knex = Knex({
      client: 'postgres',
      connection: {
        host: config.db.host,
        database: config.db.database,
        user: 'postgres'
      },
      searchPath: ['public', DbSchemaName],
      debug: false
    });
    await knex.raw(`
      CREATE SCHEMA ${DbSchemaName} AUTHORIZATION ${config.db.user};
      CREATE EXTENSION "uuid-ossp";`);

    typeormConn = await createConnection();
    await initOperation(typeormConn);
  });

  afterAll(async () => {
    console.log('> afterAll');

    await typeormConn.close();
    await knex.destroy();

    await knexAdmin.raw(`DROP DATABASE ${config.db.database}`);
    await knexAdmin.destroy();
  });

  beforeEach(async () => {
  });

  afterEach(async () => {
    await knex.raw('TRUNCATE TABLE "credentials" CASCADE');
  });

  test('create new user credentials', async () => {
    await createUserCredentials({
      email: 'admin@localhost',
      name: 'Name',
      password: 'password',
    });

    const cred = await knex('credentials').select(
      ['UUID', 'hash', 'emailVerified']).first();
    expect(cred.UUID).toBeDefined();
    expect(cred.hash).toBeDefined();
    expect(cred.emailVerified).toEqual(false);

    const user = await knex('user').select(
      ['UUID', 'email', 'name']).first();
    expect(user.UUID).toBeDefined();
    expect(user.email).toEqual('admin@localhost');
    expect(user.name).toEqual('Name');

    const sendEmailCallArgs = mockEmail.sendVerificationEmail.mock.calls[0];
    expect(sendEmailCallArgs).toBeDefined()
    expect(sendEmailCallArgs[0]).toBe('admin@localhost');
  });

  test('create credentials when user already exists', async () => {
    let {user, cred} = await createUserCredentialsEntities(typeormConn);

    await createUserCredentials({
      name: 'Name',
      password: 'password',
      email: 'admin@localhost',
    });

    let newCred = (await typeormConn.manager.findOne(Credentials)) as Credentials;
    expect(newCred).toMatchObject(cred);

    const sendEmailCallArgs = mockEmail.sendVerificationEmail.mock.calls[0];
    expect(sendEmailCallArgs[0]).toBe('admin@localhost');
  });

  test('create credentials when user already exists but email verification token expired', async () => {
    let {user: oldUser, cred: oldCred} = await createUserCredentialsEntities(
      typeormConn, {}, {emailVerificationTokenExpires: createExpiry(-1)});

    await createUserCredentials({
      name: 'Name',
      password: 'password',
      email: 'admin@localhost'
    });

    const newCred = (await typeormConn.manager.findOne(Credentials)) as Credentials;
    expect(newCred.hash).toEqual(oldCred.hash);
    expect(newCred.emailVerificationToken).not.toEqual(oldCred.emailVerificationToken);
    expect(newCred.emailVerificationTokenExpires).toBeDefined();
    expect((newCred.emailVerificationTokenExpires as Date).valueOf())
      .toBeGreaterThan((oldCred.emailVerificationTokenExpires as Date).valueOf());

    const sendEmailCallArgs = mockEmail.sendVerificationEmail.mock.calls[0];
    expect(sendEmailCallArgs[0]).toBe('admin@localhost');
  });

  test('create user when it already exists, email verified', async () => {
    let {user, cred} = await createUserCredentialsEntities(
      typeormConn, {}, {emailVerified: true});

    await createUserCredentials({
      name: 'Name',
      password: 'password',
      email: 'admin@localhost'
    });

    const updCred = await typeormConn.manager.findOne(Credentials);
    expect(updCred).toMatchObject(cred);

    const sendEmailCallArgs = mockEmail.sendLoginEmail.mock.calls[0];
    expect(sendEmailCallArgs[0]).toBe('admin@localhost');
  });

  test('verify email', async () => {
    let {user, cred} = await createUserCredentialsEntities(typeormConn);

    let updUser = (await verifyEmail('admin@localhost', 'abc')) as User;
    expect(updUser.credentials).toMatchObject({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationTokenExpires: null
    });

    const savedUser = (await typeormConn.manager.findOne(User, {relations: ['credentials']})) as User;
    expect(savedUser).toMatchObject(updUser);
  });

  test('verify email fails, token expired', async () => {
    let {user, cred} = await createUserCredentialsEntities(
      typeormConn, {}, {emailVerificationTokenExpires: createExpiry(-1)});

    const updUser = await verifyEmail('admin@localhost', 'abc');

    expect(updUser).toBeUndefined();
  });

  test('send reset password token', async () => {
    await createUserCredentialsEntities(typeormConn);

    await sendResetPasswordToken('admin@localhost');

    const updCred = (await typeormConn.manager.findOne(Credentials)) as Credentials;
    expect(updCred.resetPasswordToken).not.toBeNull();
    expect(updCred.resetPasswordTokenExpires).not.toBeNull();

    const sendEmailCallArgs = mockEmail.sendResetPasswordEmail.mock.calls[0];
    expect(sendEmailCallArgs[0]).toBe('admin@localhost');
  });

  test('send reset password token, token refreshed', async () => {
    const {user, cred} = await createUserCredentialsEntities(
      typeormConn, {}, {resetPasswordTokenExpires: createExpiry(-1)});

    await sendResetPasswordToken('admin@localhost');

    let updCred = (await typeormConn.manager.findOne(Credentials)) as Credentials;
    expect(updCred.resetPasswordToken).not.toEqual(cred.resetPasswordToken);

    const sendEmailCallArgs = mockEmail.sendResetPasswordEmail.mock.calls[0];
    expect(sendEmailCallArgs[0]).toBe('admin@localhost');
  });

  test('reset password', async () => {
    const {user, cred} = await createUserCredentialsEntities(
      typeormConn, {}, {
        resetPasswordToken: 'abc',
        resetPasswordTokenExpires: createExpiry(1)
      });

    await resetPassword('admin@localhost', 'new password', 'abc');

    let updCred = (await typeormConn.manager.findOne(Credentials)) as Credentials;
    expect(await verifyPassword('new password', updCred.hash)).toBeTruthy();
  });

  test('reset password fails, token expired', async () => {
    const {user, cred} = await createUserCredentialsEntities(
      typeormConn, {}, {
        resetPasswordToken: 'abc',
        resetPasswordTokenExpires: createExpiry(-1)
      });

    const updUser = await resetPassword('admin@localhost', 'new password', 'abc');

    expect(updUser).toBeUndefined();
  });
});

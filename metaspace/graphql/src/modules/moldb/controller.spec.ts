import {
  createTestDataset,
  createTestProject,
  createTestGroup,
  createTestUserGroup,
  createTestMolecularDB, createTestUser
} from '../../tests/testDataCreation';
import {
  adminContext,
  doQuery,
  onAfterAll,
  onAfterEach,
  onBeforeAll,
  onBeforeEach, setupTestUsers,
  testEntityManager,
  testUser, userContext
} from "../../tests/graphqlTestEnvironment";
import {UserGroupRole} from "../../binding";
import {User} from '../../modules/user/model';
import {Group, UserGroupRoleOptions as UGRO} from "../group/model";
import {getContextForTest} from "../../getContext";
import * as _mockSmApiDatabases from '../../utils/smApi/databases'

jest.mock('../../utils/smApi/databases');
const mockSmApiDatabases = _mockSmApiDatabases as jest.Mocked<typeof _mockSmApiDatabases>


describe('Molecular databases query permissions', () => {
  beforeAll(onBeforeAll);
  afterAll(onAfterAll);
  beforeEach(async () => {
    await onBeforeEach();

  });
  afterEach(onAfterEach);

  const listMolecularDBs = `{
      molecularDatabases {
        name version default public archived targeted fullName description link citation
      }
    }`;

  test('Group members can see group managed databases', async () => {
    const group = await createTestGroup();
    await setupTestUsers([group.id]);
    await createTestUserGroup(testUser.id!, group.id, UGRO.MEMBER, true);
    const {groupId, id, ...molDbExpResult} = await createTestMolecularDB(group.id);

    const result = await doQuery(listMolecularDBs, {}, { context: userContext });

    expect(result).toMatchObject([molDbExpResult]);
  });

  test('Non-group members cannot see group managed databases', async () => {
    const group = await createTestGroup();
    await setupTestUsers();
    await createTestMolecularDB(group.id);

    const result = await doQuery(listMolecularDBs, {}, { context: userContext });

    expect(result).toEqual([]);
  });

  test('Admins can see all group managed databases', async () => {
    const group = await createTestGroup();
    await setupTestUsers();
    const {groupId, id, ...molDbExpResult} = await createTestMolecularDB(group.id);

    const result = await doQuery(listMolecularDBs, {}, { context: adminContext });

    expect(result).toMatchObject([molDbExpResult]);
  });
});

describe('Molecular database mutation permissions', () => {
  beforeAll(onBeforeAll);
  afterAll(onAfterAll);
  beforeEach(async () => {
    await onBeforeEach();
  });
  afterEach(onAfterEach);

  describe('createMolecularDB mutation', () => {
    const createMolecularDB = `mutation($groupId: ID!) {
      createMolecularDB(databaseDetails: {
        name: "test-db"
        version: "v1"
        filePath: "s3://database-bucket/test-db.tsv"
        groupId: $groupId
      }) {
        id name version
      }
    }`;

    test('Group members can create database', async () => {
      const group = await createTestGroup();
      await setupTestUsers([group.id]);
      await createTestUserGroup(testUser.id!, group.id, UGRO.MEMBER, true);

      mockSmApiDatabases.smApiCreateDatabase.mockImplementation(async () => {
        return await createTestMolecularDB(group.id);
      });

      await doQuery(createMolecularDB, {groupId: group.id}, { context: userContext });
    });

    test('Non-group members cannot create database', async () => {
      const group = await createTestGroup();
      await setupTestUsers([group.id]);
      await createTestUserGroup(testUser.id!, group.id, UGRO.MEMBER, true);

      const randomGroupId = "123e4567-e89b-12d3-a456-426655440000";
      const promise = doQuery(createMolecularDB, {groupId: randomGroupId}, { context: userContext });

      await expect(promise).rejects.toThrowError(/Unauthorized/);
    });

    test('Admins can create database', async () => {
      const randomGroup = await createTestGroup();
      await setupTestUsers();

      mockSmApiDatabases.smApiCreateDatabase.mockImplementation(async () => {
        return await createTestMolecularDB(randomGroup.id);
      });

      await doQuery(createMolecularDB, {groupId: randomGroup.id}, { context: adminContext });
    });
  });

  describe('updateMolecularDB mutation', () => {
    const updateMolecularDB = `mutation($id: Int!) {
      updateMolecularDB(databaseId: $id, databaseDetails: {
        fullName: "Test database name"
        archived: true
      }) {
        id name version
      }
    }`;

    test('Group members can update database', async () => {
      const group = await createTestGroup();
      await setupTestUsers([group.id]);
      await createTestUserGroup(testUser.id!, group.id, UGRO.MEMBER, true);
      const { id } = await createTestMolecularDB(group.id);

      mockSmApiDatabases.smApiUpdateDatabase.mockImplementation(async () => {
        return { id };
      });

      await doQuery(updateMolecularDB, { id }, { context: userContext });
    });

    test('Non-group members cannot update database', async () => {
      const group = await createTestGroup();
      await setupTestUsers([group.id]);
      await createTestUserGroup(testUser.id!, group.id, UGRO.MEMBER, true);

      const randomGroup = await createTestGroup({id: "123e4567-e89b-12d3-a456-426655440000"});
      const { id } = await createTestMolecularDB(randomGroup.id);

      const promise = doQuery(updateMolecularDB, { id }, { context: userContext });
      await expect(promise).rejects.toThrowError(/Unauthorized/);
    });

    test('Admins can update database', async () => {
      await setupTestUsers();
      const randomGroup = await createTestGroup();
      const { id } = await createTestMolecularDB(randomGroup.id);

      mockSmApiDatabases.smApiUpdateDatabase.mockImplementation(async () => {
        return { id };
      });

      await doQuery(updateMolecularDB, { id }, { context: adminContext });
    });
  });


  describe('deleteMolecularDB mutation', () => {
    const deleteMolecularDB = `mutation($id: Int!) {
      deleteMolecularDB(databaseId: $id)
    }`;

    test('Group members cannot delete database', async () => {
      const group = await createTestGroup();
      await setupTestUsers([group.id]);
      await createTestUserGroup(testUser.id!, group.id, UGRO.MEMBER, true);
      const { id } = await createTestMolecularDB(group.id);

      const promise = doQuery(deleteMolecularDB, { id }, { context: userContext });
      await expect(promise).rejects.toThrowError(/Unauthorized/);
    });

    test('Admins can delete database', async () => {
      await setupTestUsers();
      const group = await createTestGroup();
      const { id } = await createTestMolecularDB(group.id);

      await doQuery(deleteMolecularDB, { id }, { context: adminContext });
    });
  });

});

import {
    adminContext,
    doQuery,
    onAfterAll, onAfterEach,
    onBeforeAll,
    onBeforeEach,
    setupTestUsers, testEntityManager
} from "../../../tests/graphqlTestEnvironment";
import {PublicationStatusOptions as PSO} from "../../project/PublicationStatusOptions";
import {
    createTestDataset,
    createTestDatasetProject,
    createTestProject
} from "../../../tests/testDataCreation";
import {Dataset as DatasetType} from "../../../binding";
import {Dataset as DatasetModel, DatasetProject as DatasetProjectModel} from "../model";
import {EngineDataset as EngineDatasetModel} from "../../engine/model";
import * as _mockSmApi from '../../../utils/smAPI';


jest.mock('../../../utils/smAPI');
const mockSmApi = _mockSmApi as jest.Mocked<typeof _mockSmApi>;

describe('Operations on datasets in publishing process', () => {
  beforeAll(onBeforeAll);
  afterAll(onAfterAll);
  beforeEach(async () => {
    await onBeforeEach();
    await setupTestUsers();
  });
  afterEach(onAfterEach);

  const deleteDataset = `mutation ($datasetId: String!) {
      deleteDataset(id: $datasetId)
    }`,
    updateDataset = `mutation ($datasetId: String!, $input: DatasetUpdateInput!) {
      updateDataset(id: $datasetId, input: $input)
    }`;

  it.each([PSO.UNDER_REVIEW, PSO.PUBLISHED])(
    'Not allowed to delete dataset in project in %s status', async (status) => {
    const datasetProject = await createTestDatasetProject(status);

    const promise = doQuery<DatasetType>(deleteDataset, { datasetId: datasetProject.datasetId });

    await expect(promise).rejects.toThrowError(/Cannot modify dataset/);
    await testEntityManager.findOneOrFail(DatasetModel, datasetProject.datasetId);
  });

  it('Not allowed to make published dataset private', async () => {
    const datasetProject = await createTestDatasetProject(PSO.PUBLISHED);

    const promise = doQuery<DatasetType>(
      updateDataset,{ datasetId: datasetProject.datasetId, input: { isPublic: false }}
    );

    await expect(promise).rejects.toThrowError(/Cannot modify dataset/);
    const { isPublic } = await testEntityManager.findOneOrFail(EngineDatasetModel, datasetProject.datasetId);
    expect(isPublic).toBe(true);
  });

  it.each([PSO.UNPUBLISHED, PSO.UNDER_REVIEW, PSO.PUBLISHED])(
      'Allowed to add datasets to project in %s status', async (status) => {
    const project = await createTestProject({ publicationStatus: status });
    const dataset = await createTestDataset();

    mockSmApi.smAPIRequest.mockReturnValue('');

    await doQuery<DatasetType>(updateDataset, { datasetId: dataset.id, input: { projectIds: [project.id] }});

    const updDataset = await testEntityManager.findOneOrFail(
      DatasetModel, dataset.id, {relations: ['datasetProjects']}
    );
    expect(updDataset.datasetProjects).toEqual(
      expect.arrayContaining([expect.objectContaining({ projectId: project.id })])
    );
  });

  it.each([PSO.UNDER_REVIEW, PSO.PUBLISHED])(
      'Not allowed to remove datasets from project in %s status', async (status) => {
    const datasetProject = await createTestDatasetProject(status);

    const promise = doQuery<DatasetType>(
      updateDataset, { datasetId: datasetProject.datasetId, input: { projectIds: [] }}
    );

    await expect(promise).rejects.toThrowError(/under_review_or_published/);
    const { projectId } = await testEntityManager.findOneOrFail(
      DatasetProjectModel, { datasetId: datasetProject.datasetId }
    );
    expect(projectId).toBeDefined();
  });

  it.each([PSO.UNDER_REVIEW, PSO.PUBLISHED])(
      'Admins allowed to remove datasets from project in %s status', async (status) => {
    const datasetProject = await createTestDatasetProject(PSO.UNDER_REVIEW);

    mockSmApi.smAPIRequest.mockReturnValue('');

    await doQuery<DatasetType>(
      updateDataset,
      { datasetId: datasetProject.datasetId, input: { projectIds: [] }},
      { context: adminContext }
    );

    const updDsProject = await testEntityManager.findOne(DatasetProjectModel, { datasetId: datasetProject.datasetId });
    expect(updDsProject).toBeFalsy();
  });
});

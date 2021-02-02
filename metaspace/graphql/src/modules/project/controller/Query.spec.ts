import * as _ from 'lodash'
import {
  createTestDataset,
  createTestProject,
  createTestProjectMember,
  createTestUserProject,
} from '../../../tests/testDataCreation'
import { Context } from '../../../context'
import { Project as ProjectType, UserProjectRole } from '../../../binding'
import { DatasetProject as DatasetProjectModel } from '../../dataset/model'
import { UserProject as UserProjectModel, UserProjectRoleOptions as UPRO } from '../model'
import {
  adminContext,
  anonContext,
  doQuery,
  onAfterAll,
  onAfterEach,
  onBeforeAll,
  onBeforeEach,
  setupTestUsers,
  shallowFieldsOfSchemaType,
  testEntityManager,
  testUser, userContext,
} from '../../../tests/graphqlTestEnvironment'
import { createBackgroundData } from '../../../tests/backgroundDataCreation'

// ROLE_COMBOS is a list of possible user & project role combinations, for tests that should exhaustively check every possibility
// When running Jest against a single file, it shows a concise list of all sub-tests, which makes it easy to see patterns
// of failures across the different combinations
type UserRole = 'anon' | 'user' | 'admin';
type ProjectRole = UserProjectRole | null;
const ROLE_COMBOS: [UserRole, ProjectRole][] = [
  ['anon', null],
  ['user', null],
  ['user', UPRO.PENDING],
  ['user', UPRO.INVITED],
  ['user', UPRO.MEMBER],
  ['user', UPRO.MANAGER],
  ['user', UPRO.REVIEWER],
  ['admin', null],
  ['admin', UPRO.PENDING],
  ['admin', UPRO.INVITED],
  ['admin', UPRO.MEMBER],
  ['admin', UPRO.MANAGER],
  ['admin', UPRO.REVIEWER],
]
const getContextByRole = (userRole: UserRole) => ({
  anon: anonContext,
  user: userContext,
  admin: adminContext,
} as Record<UserRole, Context>)[userRole]

describe('modules/project/controller (queries)', () => {
  const projectFields = shallowFieldsOfSchemaType('Project')
  let userId: string

  const setupProject = async(userRole: UserRole, projectRole: ProjectRole,
    options?: {isPublic?: boolean, otherMemberRole?: ProjectRole}) => {
    const { isPublic = false } = options || {}

    const project = await createTestProject({ isPublic })
    const projectId = project.id
    const context = getContextByRole(userRole)
    const userId = context.user && context.user.id

    if (userId != null) {
      await createTestUserProject(userId, projectId, projectRole)
    }

    return { project, projectId, context }
  }

  beforeAll(onBeforeAll)
  afterAll(onAfterAll)
  beforeEach(async() => {
    await onBeforeEach()
    await setupTestUsers()
    userId = testUser.id
  })
  afterEach(onAfterEach)

  describe('Query.project', () => {
    const query = `query ($projectId: ID!) {
      project (projectId: $projectId) { ${projectFields} }
    }`
    const membersQuery = `query ($projectId: ID!) {
      project (projectId: $projectId) { members { role user { id name email } } }
    }`

    describe('should give access to all public projects', () => {
      it.each(ROLE_COMBOS)('user role: %s, group role: %s', async(userRole, projectRole) => {
        // Arrange
        const { project, projectId, context } = await setupProject(userRole, projectRole, { isPublic: true })

        // Act
        const result = await doQuery(query, { projectId }, { context })

        // Assert
        expect(result).toEqual(expect.objectContaining({
          id: project.id,
          name: project.name,
          urlSlug: project.urlSlug,
          isPublic: project.isPublic,
          createdDT: project.createdDT.toISOString(),
          currentUserRole: projectRole,
        }))
      })
    })

    describe('should hide private projects from logged-out users and unaffiliated users', () => {
      it.each(ROLE_COMBOS)('user role: %s, group role: %s', async(userRole: UserRole, projectRole: ProjectRole) => {
        // Arrange
        const { projectId, context } = await setupProject(userRole, projectRole)

        // Act
        const result = await doQuery(query, { projectId }, { context })

        // Assert
        if (userRole === 'admin' || (projectRole && projectRole != UPRO.PENDING)) {
          expect(result).toEqual(expect.objectContaining({
            isPublic: false,
            currentUserRole: projectRole,
            numMembers: ([UPRO.MEMBER, UPRO.MANAGER] as ProjectRole[]).includes(projectRole) ? 1 : 0,
          }))
        } else {
          expect(result).toEqual(null)
        }
      })
    })

    describe('should show group members to admins and other members', () => {
      it.each(ROLE_COMBOS)('user role: %s, group role: %s', async(userRole: UserRole, projectRole: ProjectRole) => {
        // Arrange
        const { projectId, context } = await setupProject(userRole, projectRole, { isPublic: true })
        const otherMember = await createTestProjectMember(projectId)

        // Act
        const result = await doQuery(membersQuery, { projectId }, { context })

        // Assert
        // Flatten & extract fields of interest to improve readability
        const members = result && result.members && (result.members as any[])
          .map(({ user: { id, name, email } }) => ({ id, name, email }))

        let expectedMembers
        if (userRole === 'admin' || projectRole === UPRO.MANAGER) {
          const { id, name, email } = otherMember
          expectedMembers = expect.arrayContaining([{ id, name, email }])
        } else if (projectRole === UPRO.MEMBER) {
          const { id, name } = otherMember
          expectedMembers = expect.arrayContaining([{ id, name, email: null }])
        } else {
          expectedMembers = []
        }

        expect(members).toEqual(expectedMembers)
      })
    })
  })

  describe('Query.projectByUrlSlug', () => {
    const query = `query ($urlSlug: String!) {
      projectByUrlSlug (urlSlug: $urlSlug) { ${projectFields} }
    }`

    it('should find a project by URL slug', async() => {
      // Create several projects so that we can be sure it's finding the right one, not just the first one
      const projectPromises = ['abc', 'def', 'foo_bar', 'jkl', 'mno']
        .map(async urlSlug => await createTestProject({ urlSlug }))
      const projects = await Promise.all(projectPromises)

      const result1 = await doQuery<ProjectType>(query, { urlSlug: 'foo_bar' })
      const result2 = await doQuery<ProjectType>(query, { urlSlug: 'FOO_BAR' })
      const result3 = await doQuery<ProjectType>(query, { urlSlug: 'foo-BAR' })

      expect([result1.id, result2.id, result3.id])
        .toEqual([projects[2].id, projects[2].id, projects[2].id])
    })
  })

  describe('Query.allProjects', () => {
    const searchQuery = `query ($query: String) {
      allProjects (query: $query) { ${projectFields} }
    }`
    const countQuery = `query ($query: String) {
      projectsCount (query: $query)
    }`

    describe('should give access to all public projects', () => {
      it.each(ROLE_COMBOS)('user role: %s, group role: %s', async(userRole, projectRole) => {
        // Arrange
        const { project, context } = await setupProject(userRole, projectRole, { isPublic: true })

        // Act
        const result = await doQuery(searchQuery, {}, { context })
        const count = await doQuery(countQuery, {}, { context })

        // Assert
        expect(result).toEqual([
          expect.objectContaining({
            id: project.id,
            name: project.name,
            urlSlug: project.urlSlug,
            isPublic: project.isPublic,
            createdDT: project.createdDT.toISOString(),
            currentUserRole: projectRole,
          }),
        ])
        expect(count).toEqual(1)
      })
    })

    describe('should hide private projects from logged-out users and unaffiliated users', () => {
      it.each(ROLE_COMBOS)('user role: %s, group role: %s', async(userRole: UserRole, projectRole: ProjectRole) => {
        // Arrange
        const { projectId, context } = await setupProject(userRole, projectRole)

        // Act
        const result = await doQuery(searchQuery, {}, { context })
        const count = await doQuery(countQuery, {}, { context })

        // Assert
        if (userRole === 'admin' || (projectRole && projectRole != UPRO.PENDING)) {
          expect(result).toEqual([
            expect.objectContaining({
              id: projectId,
              isPublic: false,
              currentUserRole: projectRole,
              numMembers: ([UPRO.MEMBER, UPRO.MANAGER] as ProjectRole[]).includes(projectRole) ? 1 : 0,
            }),
          ])
          expect(count).toEqual(1)
        } else {
          expect(result).toEqual([])
          expect(count).toEqual(0)
        }
      })
    })

    describe('should filter by query', () => {
      const names = [
        'foo bar',
        'The Foo Project',
        'Testing 123 123',
        'All foo all the time',
        '(foo) project',
        '[foo] test project',
      ]
      it.each([
        ['foo', [0, 1, 3, 4, 5]],
        ['project', [1, 4, 5]],
        // Full-text version: ['foo project', [1, 4]], // All words should be matched
        ['foo project', [1]],
        ['project foo', []], // Order should matter
        // Full-text version: ['the', [0, 1, 2, 3, 4, 5]], // Common words like "the" and "it" should be completely ignored
        ['the', [1, 3]],
        ['test', [2, 5]],
        ['all the tim', [3]], // The last word should be a prefix search - e.g. "tim" should match "time"
        ['tes project', []], // Non-last words shouldn't be prefix searched
        // Full-text version: ['() [] \' " % & | ~ ! foo', [0, 1, 3, 4, 5]], // Symbols, etc. should be ignored
        ['() [] \' " % & | ~ ! foo', []], // Symbols, etc. should not cause errors
        ['(', [4]], // Symbols should be matched
        ['[', [5]], // Symbols should be matched
      ])('should find expected results for %s', async(searchTerm: string, matchedNameIdxs: number[]) => {
        await Promise.all(names.map(name => createTestProject({ name })))
        const sortedNames = matchedNameIdxs.map(idx => names[idx]).sort()

        const results = await doQuery<any[]>(searchQuery, { query: searchTerm })
        const count = await doQuery(countQuery, { query: searchTerm })

        expect(_.sortBy(results, ['name'])).toEqual(sortedNames.map(name => expect.objectContaining({ name })))
        expect(count).toEqual(matchedNameIdxs.length)
      })
    })
  })

  describe('Query.currentUser.projects', () => {
    const query = `query {
      currentUser { projects { role numDatasets project { members { role } } } }
    }`

    it('should return the current user\'s projects', async() => {
      const roles = [UPRO.INVITED, UPRO.PENDING, UPRO.MEMBER, UPRO.MANAGER] as UserProjectRole[]
      const projects = await Promise.all(roles.map(async(role, idx) => {
        const project = await createTestProject()
        await testEntityManager.save(UserProjectModel, { userId, projectId: project.id, role })
        const datasets = await Promise.all(_.range(idx).map(() => createTestDataset({ userId })))
        await testEntityManager.save(DatasetProjectModel, datasets.map(({ id }) => ({ datasetId: id, projectId: project.id, approved: true })))
        return project
      }))
      await createBackgroundData({ projects: true, datasetsForProjectIds: projects.map(p => p.id) })

      const result = await doQuery(query)

      expect(result.projects).toEqual(expect.arrayContaining([
        { role: UPRO.INVITED, numDatasets: 0, project: { members: [] } },
        { role: UPRO.PENDING, numDatasets: 1, project: { members: [] } },
        { role: UPRO.MEMBER, numDatasets: 2, project: { members: expect.arrayContaining([expect.anything()]) } },
        { role: UPRO.MANAGER, numDatasets: 3, project: { members: expect.arrayContaining([expect.anything()]) } },
      ]))
    })
  })
})

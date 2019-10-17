import {Context} from '../../../context';
import {
  Project as ProjectModel,
  UserProject as UserProjectModel,
  UserProjectRoleOptions as UPRO
} from '../model';
import {PublicationStatusOptions as PSO} from '../PublicationStatusOptions';
import {UserError} from 'graphql-errors';
import {FieldResolversFor, ProjectSource, ScopeRoleOptions as SRO, UserProjectSource} from '../../../bindingTypes';
import {Mutation, PublicationStatus} from '../../../binding';
import {ProjectSourceRepository} from '../ProjectSourceRepository';
import {DatasetProject as DatasetProjectModel} from '../../dataset/model';
import updateUserProjectRole from '../operation/updateUserProjectRole';
import {convertUserToUserSource} from '../../user/util/convertUserToUserSource';
import {createInactiveUser} from '../../auth/operation';
import updateProjectDatasets from '../operation/updateProjectDatasets';
import updateDatasetsPublicationStatus from '../operation/updateDatasetsPublicationStatus';
import {User as UserModel} from '../../user/model';
import config from '../../../utils/config';
import {sendInvitationEmail} from '../../auth';
import {findUserByEmail} from '../../../utils';
import {sendAcceptanceEmail, sentGroupOrProjectInvitationEmail, sendRequestAccessEmail} from '../../groupOrProject/email';
import {smAPIUpdateDataset} from '../../../utils/smAPI';
import {getDatasetForEditing} from '../../dataset/operation/getDatasetForEditing';
import * as crypto from 'crypto';


const asyncAssertCanEditProject = async (ctx: Context, projectId: string) => {
  const userProject = await ctx.entityManager.getRepository(UserProjectModel).findOne({
    where: { projectId, userId: ctx.getUserIdOrFail(), role: UPRO.MANAGER },
  });
  if (!ctx.isAdmin && userProject == null) {
    throw new UserError('Unauthorized');
  }
};

const generateRandomToken = () => {
  // 9 Bytes = 72 bits = 12 Base64 symbols
  return crypto.randomBytes(9).toString('base64')
    .replace(/\//g,'_').replace(/\+/g,'-');
};

const MutationResolvers: FieldResolversFor<Mutation, void> = {
  async createProject(source, { projectDetails }, ctx): Promise<ProjectSource> {
    const userId = ctx.getUserIdOrFail(); // Exit early if not logged in
    const { name, isPublic, urlSlug } = projectDetails;
    if (!ctx.isAdmin && urlSlug != null) {
      throw new UserError('urlSlug can only be set by METASPACE administrators');
    }

    const projectRepository = ctx.entityManager.getRepository(ProjectModel);
    const newProject = projectRepository.create({ name, isPublic, urlSlug });
    await projectRepository.insert(newProject);
    await ctx.entityManager.getRepository(UserProjectModel)
      .insert({
        projectId: newProject.id,
        userId: ctx.user!.id,
        role: UPRO.MANAGER,
      });
    const project = await ctx.entityManager.getCustomRepository(ProjectSourceRepository)
      .findProjectById(ctx.user, newProject.id);
    if (project != null) {
      return project;
    } else {
      throw Error(`Project became invisible to user after create ${newProject.id}`);
    }
  },

  async updateProject(source, { projectId, projectDetails }, ctx): Promise<ProjectSource> {
    await asyncAssertCanEditProject(ctx, projectId);

    if (projectDetails.urlSlug !== undefined && !ctx.isAdmin) {
      throw new UserError('urlSlug can only be set by METASPACE administrators');
    }

    const projectRepository = ctx.entityManager.getRepository(ProjectModel);
    let project = await ctx.entityManager.getCustomRepository(ProjectSourceRepository)
      .findProjectById(ctx.user, projectId);
    if (project == null) {
      throw new UserError(`Not found project ${projectId}`);
    }
    if ([PSO.UNDER_REVIEW, PSO.PUBLISHED].includes(project.publicationStatus) && projectDetails.isPublic != null) {
      throw new UserError(`Cannot modify project ${projectId} as it is in ${project.publicationStatus} status`);
    }

    await projectRepository.update(projectId, projectDetails);
    if (projectDetails.name || projectDetails.urlSlug || projectDetails.isPublic) {
      const affectedDatasets = await ctx.entityManager.getRepository(DatasetProjectModel)
        .find({where: { projectId }, relations: ['dataset', 'dataset.datasetProjects']});
      await Promise.all(affectedDatasets.map(async dp => {
        await smAPIUpdateDataset(dp.datasetId, {
          projectIds: dp.dataset.datasetProjects.map(p => p.projectId)
        })
      }));
    }

    project = await ctx.entityManager.getCustomRepository(ProjectSourceRepository)
      .findProjectById(ctx.user, projectId);
    if (project != null) {
      return project;
    } else {
      throw Error(`Project became invisible to user after update ${projectId}`);
    }
  },

  async deleteProject(source, { projectId }, ctx): Promise<Boolean> {
    await asyncAssertCanEditProject(ctx, projectId);

    const projectRepository = ctx.entityManager.getRepository(ProjectModel);
    const project = await projectRepository.findOne({ id: projectId });

    if (project) {
      if (project.publicationStatus == PSO.UNPUBLISHED) {
        const affectedDatasets = await ctx.entityManager.getRepository(DatasetProjectModel)
          .find({where: { projectId }, relations: ['dataset', 'dataset.datasetProjects']});
        await ctx.entityManager.getRepository(DatasetProjectModel).delete({ projectId });
        await Promise.all(affectedDatasets.map(async dp => {
          await smAPIUpdateDataset(dp.datasetId, {
            projectIds: dp.dataset.datasetProjects
              .filter(p => p.projectId !== projectId)
              .map(p => p.projectId)
          })
        }));

        await ctx.entityManager.getRepository(UserProjectModel).delete({ projectId });
        await projectRepository.delete({ id: projectId });
      } else {
        throw new UserError(`Cannot modify project ${projectId} as it is in ${project.publicationStatus} status`);
      }
    }
    return true;
  },

  async leaveProject(source, { projectId }, ctx: Context): Promise<Boolean> {
    await updateUserProjectRole(ctx, ctx.getUserIdOrFail(), projectId, null);
    return true;
  },

  async removeUserFromProject(source, { projectId, userId }, ctx): Promise<Boolean> {
    await updateUserProjectRole(ctx, userId, projectId, null);

    return true;
  },

  async requestAccessToProject(source, { projectId }, ctx): Promise<UserProjectSource> {
    const userId = ctx.getUserIdOrFail();
    await updateUserProjectRole(ctx, userId, projectId, UPRO.PENDING);
    const userProject = await ctx.entityManager.getRepository(UserProjectModel)
      .findOneOrFail({ userId, projectId }, { relations: ['user', 'project'] });

    const managers = await ctx.entityManager.getRepository(UserProjectModel)
      .find({where: {projectId, role: UPRO.MANAGER}, relations: ['user'] });
    managers.forEach(manager => {
      sendRequestAccessEmail('project', manager.user, userProject.user, userProject.project);
    });

    // NOTE: In the return value, some role-dependent fields like `userProject.project.currentUserRole` will still reflect
    // the user's role before the request was made. The UI currently doesn't rely on the result, but if it does,
    // it may be necessary to make a way to update the cached ctx.getUserProjectRoles() value
    return { ...userProject, user: convertUserToUserSource(userProject.user, SRO.OTHER) };
  },

  async acceptRequestToJoinProject(source, { projectId, userId }, ctx: Context): Promise<UserProjectSource> {
    await updateUserProjectRole(ctx, userId, projectId, UPRO.MEMBER);
    const userProject = await ctx.entityManager.getRepository(UserProjectModel)
      .findOneOrFail({ userId, projectId }, { relations: ['user', 'project'] });

    sendAcceptanceEmail('project', userProject.user, userProject.project);

    // NOTE: This return value has the same issue with role-dependent fields as `requestAccessToProject`
    return { ...userProject, user: convertUserToUserSource(userProject.user, SRO.OTHER) };
  },

  async inviteUserToProject(source, { projectId, email }, ctx: Context): Promise<UserProjectSource> {
    let user = await findUserByEmail(ctx.entityManager, email)
      || await findUserByEmail(ctx.entityManager, email, 'not_verified_email');
    const currentUser = await ctx.entityManager.getRepository(UserModel).findOneOrFail(ctx.getUserIdOrFail());
    if (user == null) {
      user = await createInactiveUser(email);
      const link = `${config.web_public_url}/account/create-account`;
      sendInvitationEmail(email, currentUser.name || '', link);
    } else {
      const project = await ctx.entityManager.getRepository(ProjectModel).findOneOrFail(projectId);
      sentGroupOrProjectInvitationEmail('project', user, currentUser, project);
    }
    const userId = user.id;

    await updateUserProjectRole(ctx, userId, projectId, UPRO.INVITED);

    const userProject = await ctx.entityManager.getRepository(UserProjectModel)
      .findOneOrFail({ userId, projectId }, { relations: ['user'] });
    return { ...userProject, user: convertUserToUserSource(userProject.user, SRO.OTHER) };
  },

  async acceptProjectInvitation(source, { projectId }, ctx): Promise<UserProjectSource> {
    const userId = ctx.getUserIdOrFail();
    await updateUserProjectRole(ctx, userId, projectId, UPRO.MEMBER);
    const userProject = await ctx.entityManager.getRepository(UserProjectModel)
      .findOneOrFail({ userId, projectId }, { relations: ['user'] });
    return { ...userProject, user: convertUserToUserSource(userProject.user, SRO.OTHER) };
  },

  async updateUserProject(source, {projectId, userId, update}, ctx): Promise<boolean> {
    await asyncAssertCanEditProject(ctx, projectId);
    await updateUserProjectRole(ctx, userId, projectId, update.role || null);
    return true;
  },

  async importDatasetsIntoProject(source, { projectId, datasetIds }, ctx): Promise<Boolean> {
    const userProjectRole = (ctx.user != null ? await ctx.user.getProjectRoles() : {})[projectId];
    if (userProjectRole == null) {
      throw new UserError('Not a member of project');
    }
    if (datasetIds.length > 0) {
      // Verify user is allowed to edit the datasets
      await Promise.all(datasetIds.map(async (dsId: string) => {
        await getDatasetForEditing(ctx.entityManager, ctx.user, dsId);
      }));

      const approved = [UPRO.MEMBER, UPRO.MANAGER].includes(userProjectRole);
      await updateProjectDatasets(ctx, projectId, datasetIds, approved);
    }

    return true;
  },

  async createReviewLink(source, {projectId}, ctx) {
    await asyncAssertCanEditProject(ctx, projectId);

    const projectRepository = ctx.entityManager.getRepository(ProjectModel);
    const projectDetails = {
      reviewToken: generateRandomToken(),
      publicationStatus: PSO.UNDER_REVIEW,
    };
    await projectRepository.update(projectId, projectDetails);
    await updateDatasetsPublicationStatus(ctx, projectId, PSO.UNDER_REVIEW);

    return `/api_auth/review?prj=${projectId}&token=${projectDetails.reviewToken}`;
  },

  async deleteReviewLink(source, {projectId}, ctx) {
    await asyncAssertCanEditProject(ctx, projectId);

    const projectRepository = ctx.entityManager.getRepository(ProjectModel);
    await projectRepository.update({ id: projectId },
      { reviewToken: null, publicationStatus: PSO.UNPUBLISHED });
    await updateDatasetsPublicationStatus(ctx, projectId, PSO.UNPUBLISHED);
    return true;
  }
};

export default MutationResolvers;

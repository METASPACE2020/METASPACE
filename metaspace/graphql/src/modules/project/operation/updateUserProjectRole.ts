import {Context} from '../../../context';
import {UserProjectRole} from '../../../binding';
import {Project as ProjectModel, UserProject as UserProjectModel, UserProjectRoleOptions as UPRO} from '../model';
import {User as UserModel} from '../../user/model';
import {UserError} from "graphql-errors";
import {DatasetProject as DatasetProjectModel} from '../../dataset/model';
import {projectIsVisibleToCurrentUserWhereClause} from '../util/projectIsVisibleToCurrentUserWhereClause';
import {In} from 'typeorm';

export default async (ctx: Context, userId: string, projectId: string, newRole: UserProjectRole | null) => {
  const currentUserId = ctx.getUserIdOrFail();
  const currentUserProjectRoles = await ctx.getCurrentUserProjectRoles();
  const userProjectRepository = ctx.connection.getRepository(UserProjectModel);
  const datasetProjectRepository = ctx.connection.getRepository(DatasetProjectModel);
  const user = await ctx.connection.getRepository(UserModel).findOne(userId);
  if (user == null) throw new UserError('User not found');

  const project = await ctx.connection.getRepository(ProjectModel)
    .createQueryBuilder('project')
    .leftJoinAndSelect('project.members', 'member')
    .where(projectIsVisibleToCurrentUserWhereClause(ctx, currentUserProjectRoles))
    .andWhere('project.id = :projectId', {projectId})
    .getOne();
  if (project == null) throw new UserError('Project not found');

  const existingUserProject = project.members.find(up => up.userId === userId);
  const existingRole = existingUserProject != null ? existingUserProject.role : null;
  const currentUserUserProject = project.members.find(up => up.userId === currentUserId);
  const currentUserRole = currentUserUserProject != null ? currentUserUserProject.role : null;

  if (newRole === existingRole) return;

  // Validate
  if (!ctx.isAdmin) {
    type Transition = { from: UserProjectRole | null, to: UserProjectRole | null, allowedIf: () => Boolean };
    const allowedTransitions: Transition[] = [
      // Request access flow
      { from: null, to: UPRO.PENDING, allowedIf: () => currentUserId === userId },
      { from: UPRO.PENDING, to: null, allowedIf: () => currentUserId === userId || currentUserRole === UPRO.MANAGER },
      { from: UPRO.PENDING, to: UPRO.MEMBER, allowedIf: () => currentUserRole === UPRO.MANAGER },
      // Invitation flow
      { from: null, to: UPRO.INVITED, allowedIf: () => currentUserRole === UPRO.MANAGER },
      { from: UPRO.INVITED, to: null, allowedIf: () => currentUserId === userId || currentUserRole === UPRO.MANAGER },
      { from: UPRO.INVITED, to: UPRO.MEMBER, allowedIf: () => currentUserId === userId },
      // Leave / remove from group
      { from: UPRO.MEMBER, to: null, allowedIf: () => currentUserId === userId || currentUserRole === UPRO.MANAGER },
    ];
    const transition = allowedTransitions.find(t => t.from === existingRole && t.to === newRole);
    if (!transition || !transition.allowedIf()) {
      throw new UserError('Unauthorized');
    }
  }

  // Update DB
  if (existingUserProject == null) {
    await userProjectRepository.insert({userId, projectId, role: newRole!});
  } else if (newRole == null) {
    await userProjectRepository.delete({userId, projectId});
  } else {
    await userProjectRepository.update({userId, projectId}, {role: newRole});
  }

  // Update ProjectDatasets' "approved" status
  const approved = ([UPRO.MANAGER, UPRO.MEMBER] as (UserProjectRole|null)[]).includes(newRole);
  const datasetsToUpdate = await datasetProjectRepository
    .createQueryBuilder('datasetProject')
    .select('dataset.id', 'id')
    .leftJoinAndSelect('datasetProject.dataset', 'dataset')
    .where('dataset.userId = :userId AND datasetProject.approved != :approved', {userId, approved})
    .getRawMany();
  if (datasetsToUpdate.length > 0) {
    const datasetIdsToUpdate = datasetsToUpdate.map(ds => ds.id as string);
    await datasetProjectRepository.update({ projectId, datasetId: In(datasetIdsToUpdate) }, { approved });
  }
  // TODO: Trigger elasticsearch reindexing of datasets

  if (!ctx.isAdmin) {
    // TODO: Send emails
  }
};

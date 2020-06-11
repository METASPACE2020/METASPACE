import {FieldResolversFor} from '../../bindingTypes';
import {MolecularDB, Mutation, Query} from '../../binding';
import {MolecularDB as MolecularDbModel} from './model';
import logger from '../../utils/logger';
import {IResolvers} from 'graphql-tools';
import {Context} from '../../context';
import {UserError} from 'graphql-errors';
import {smApiCreateDatabase, smApiUpdateDatabase, smApiDeleteDatabase} from '../../utils/smApi/databases';
import {assertImportFileIsValid} from './util/assertImportFileIsValid';
import {mapToMolecularDB} from './util/mapToMolecularDB';
import {MolecularDbRepository} from './MolecularDbRepository'


const QueryResolvers: FieldResolversFor<Query, void> = {
  async molecularDatabases(source, { hideArchived }, ctx): Promise<MolecularDB[]> {
    let databases = await ctx.entityManager.getCustomRepository(MolecularDbRepository).findDatabases(ctx.user);
    if (hideArchived) {
      databases = databases.filter(db => !db.archived)
    }
    return databases.map(db => mapToMolecularDB(db));
  },
};

const assertUserBelongsToGroup = (ctx: Context, groupId: string) => {
  if (!ctx.isAdmin) {
    ctx.getUserIdOrFail(); // Exit early if not logged in
    if (!ctx.user.groupIds || !ctx.user.groupIds.includes(groupId)) {
      throw new UserError(`Unauthorized`);
    }
  }
};

const assertUserCanEditMolecularDB = async (ctx: Context, databaseId: number) => {
  const database = await ctx.entityManager.getCustomRepository(MolecularDbRepository)
    .findDatabaseById(ctx, databaseId);
  if (database.public) {
    throw new UserError('Cannot edit public database');
  }
  if (database.groupId != null) {
    assertUserBelongsToGroup(ctx, database.groupId);
  }
};

const MutationResolvers: FieldResolversFor<Mutation, void>  = {

  async createMolecularDB(source, { databaseDetails }, ctx): Promise<MolecularDB> {
    logger.info(`User ${ctx.user.id} is creating molecular database ${JSON.stringify(databaseDetails)}`);
    const groupId = databaseDetails.groupId as string;
    assertUserBelongsToGroup(ctx, groupId);

    await assertImportFileIsValid(databaseDetails.filePath);

    const { id } = await smApiCreateDatabase({ ...databaseDetails, groupId });
    const database = await ctx.entityManager.getCustomRepository(MolecularDbRepository).findDatabaseById(ctx, id);
    return mapToMolecularDB(database);
  },

  async updateMolecularDB(source, { databaseId, databaseDetails }, ctx): Promise<MolecularDB> {
    logger.info(`User ${ctx.user.id} is updating molecular database ${JSON.stringify(databaseDetails)}`);
    await assertUserCanEditMolecularDB(ctx, databaseId);

    const { id } = await smApiUpdateDatabase(databaseId, databaseDetails);
    const database = await ctx.entityManager.getCustomRepository(MolecularDbRepository)
      .findDatabaseById(ctx, id);
    return mapToMolecularDB(database);
  },

  async deleteMolecularDB(source, { databaseId}, ctx): Promise<Boolean> {
    logger.info(`User ${ctx.user.id} is deleting molecular database ${databaseId}`);
    if (!ctx.isAdmin) {
      throw new UserError(`Unauthorized`);
    }

    await smApiDeleteDatabase(databaseId);
    return true;
  },
};

export const Resolvers = {
  Query: QueryResolvers,
  Mutation: MutationResolvers,
} as IResolvers<any, Context>;

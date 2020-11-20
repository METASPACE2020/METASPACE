const cryptoRandomString = require('crypto-random-string')
import { utc } from 'moment';

import {Context} from '../../context';
import logger from '../../utils/logger';
import {esAnnotationByID} from '../../../esConnector';
import {ImageViewerLink, Annotation} from '../../binding';
import {ImageViewerLink as ImageViewerLinkModel} from './model'

export const Resolvers = {
  Query: {
    async imageViewerLink(_: any, {id, datasetId}: any, ctx: Context): Promise<ImageViewerLink | undefined> {
      const ivl = await ctx.entityManager.getRepository(ImageViewerLinkModel).findOne({ id, datasetId });
      if (ivl) {
        const annotations = await Promise.all(ivl.annotationIds.map(id => esAnnotationByID(id, ctx.user)))
        return {
          ...ivl,
          annotations: annotations.filter(a => a !== null) as unknown as Annotation[],
        }
      }
    },
  },
  Mutation: {
    async createImageViewerLink(_: any, { input }: any, {user, entityManager}: Context): Promise<string> {
      logger.info(`Creating image viewer link for ${input.datasetId} dataset by '${user!.id}' user...`);

      const id = cryptoRandomString({ length: 8, type: 'url-safe' })

      const entity = {
        id,
        ...input,
        userId: user.id,
        createdDT: utc(),
      }

      await entityManager.getRepository(ImageViewerLinkModel).save(entity);

      logger.info(`Image viewer link created with id ${id}`);
      return id;
    },
  }
}

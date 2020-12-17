import * as http from 'http';
import * as crypto from 'crypto';
import {Router, Request, Response, NextFunction} from 'express';
import * as companion from '@uppy/companion';
import * as genUuid from "uuid";
import * as bodyParser from "body-parser";

import config from '../../utils/config';

function signUuid(uuid: string) {
  const hmac = crypto.createHmac('sha1', config.aws.aws_secret_access_key);
  return hmac.update(uuid).digest('base64');
}

/**
 * Generate a uuid to be used as the destination directory in S3, and sign it. This server-supplied signature can
 * validate that the client hasn't tampered with the upload destination in an attempt to access/overwrite
 * other peoples' data.
 * @param req
 * @param res
 * @param next
 */
function generateUuidForUpload(req: Request, res: Response, next: NextFunction) {
  const uuid = genUuid();
  const uuidSignature = signUuid(uuid)
  res.json({uuid, uuidSignature});
}

export default function (httpServer?: http.Server) {
  const providerOptions =
      config.aws ? {
        s3: {
          getKey: (req: Request, filename: string, metadata: object) => {
            const { uuid, uuidSignature } = req.query
            const signedUuid = signUuid(uuid)
            if (signedUuid !== uuidSignature) {
              throw new Error('uuid is not valid')
            }
            return `${uuid}/${filename}`
          },
          key: config.aws.aws_access_key_id,
          secret: config.aws.aws_secret_access_key,
          bucket: config.upload.bucket,
          region: config.aws.aws_region,
          useAccelerateEndpoint: false,  // default: false,
          expires: 300,  // default: 300 (5 minutes)
          acl: 'private',  // default: public-read
        }
      } : {}

  const options = {
    providerOptions,
    server: {
      host: `localhost:${config.img_storage_port}`,
      protocol: 'http',
      path: '/dataset_upload',
    },
    filePath: '/tmp',
    debug: true,
  };

  const router = Router()
  router.use(bodyParser.json())
  router.get('/s3/uuid', generateUuidForUpload)
  router.use(companion.app(options))
  if (httpServer) {
    companion.socket(httpServer, options);
  }
  return router
}
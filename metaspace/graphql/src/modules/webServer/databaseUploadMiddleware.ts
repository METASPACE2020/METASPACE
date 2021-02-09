import * as http from 'http';
import * as express from 'express';
import * as companion from '@uppy/companion';
import * as genUuid from "uuid";
import config from '../../utils/config';
import * as bodyParser from "body-parser";
import getCompanionOptions from './getCompanionOptions'

export default function (httpServer: http.Server) {
  const options = getCompanionOptions(
    '/database_upload',
    (req: express.Request, filename: string, metadata: object) => {
      return `${config.upload.moldb_prefix}/${genUuid()}/${filename}`
    }
  )

  const router = express.Router()
  router.use(bodyParser.json({ limit: '1MB' }))
  router.use(companion.app(options))
  companion.socket(httpServer, options);
  return router
}

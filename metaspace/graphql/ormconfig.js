// TypeORM bizarrely doesn't support TS-based config files yet...
require('ts-node/register');
module.exports = require('./src/utils/typeOrmConfig.ts').default;

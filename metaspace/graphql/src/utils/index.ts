export {createConnection, findUserByEmail} from './db';
export {smAPIRequest} from './smAPI';

export type LooselyCompatible<T> =
  {[K in keyof T]?: T[K] extends (string | number | null | undefined) ? T[K] | null : any};

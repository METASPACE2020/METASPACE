from __future__ import annotations

import json
import logging
from base64 import urlsafe_b64encode
from hashlib import blake2b

import numpy as np

logger = logging.getLogger('annotation-pipeline')


def ds_dims(coordinates):
    min_x, min_y = np.amin(coordinates, axis=0)[:2]
    max_x, max_y = np.amax(coordinates, axis=0)[:2]
    nrows, ncols = max_y - min_y + 1, max_x - min_x + 1
    return nrows, ncols


def get_pixel_indices(coordinates):
    """
    Converts original spectrum indexes (which may be out of order, or sparse) to "sp_i" values,
    which represent the pixel index of the output image, i.e. `y, x = divmod(sp_i, width)`.
    """
    _coord = np.array(coordinates, dtype=np.int64)[:, :2]
    _coord -= np.amin(_coord, axis=0)

    ncols = np.max(_coord[:, 0]) + 1
    pixel_indices = _coord[:, 1] * ncols + _coord[:, 0]
    return pixel_indices.astype(np.uint32)


def jsonhash(obj) -> str:
    """
    Calculates a hash for a JSON-stringifiable object. Intended for compacting large sets of
    parameters into a simple key that can be used to distinctly identify a cache entry.

    The output is collision-resistant, but shouldn't be assumed to be cryptographically secure.
    In most cases a motivated adversary could figure out the original object contents easily, as
    there's no hidden key and it's unlikely there will be much variety in the objects hashed.
    """
    json_val = json.dumps(obj, sort_keys=True)
    hash_val = blake2b(json_val.encode(), digest_size=12).digest()
    return str(urlsafe_b64encode(hash_val), 'utf-8')

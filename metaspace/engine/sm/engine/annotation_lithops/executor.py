import inspect
import logging
import resource
from time import time
from typing import List

import lithops
from lithops.future import ResponseFuture

from sm.engine.annotation_lithops.utils import PipelineStats

logger = logging.getLogger('custom-executor')


class Executor:
    def __init__(self, lithops_config):
        self.is_local = lithops_config['lithops']['executor'] == 'localhost'

        if self.is_local:
            self.large_executor = self.small_executor = lithops.local_executor(
                config=lithops_config, storage_backend='localhost'
            )
        else:
            self.small_executor = lithops.function_executor(config=lithops_config)
            self.large_executor = lithops.function_executor(
                config=lithops_config, type='standalone', backend='ibm_vpc'
            )
        self.storage = self.small_executor.storage

    def map(self, func, args, *, runtime_memory=None, unpack=False, **kwargs):
        def wrapper_func(*args, **kwargs):
            def get_meta():
                return {
                    'inner_time': time() - t,
                    'mem_before': mem_before,
                    'mem_after': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                }

            mem_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            t = time()
            try:
                result = func(*args, **kwargs)
                return result, get_meta()
            except Exception as ex:
                ex.executor_meta = get_meta()
                raise

        wrapper_func.__signature__ = inspect.signature(func)
        wrapper_func.__name__ = func.__name__

        if runtime_memory is None:
            runtime_memory = 512

        while True:
            try:
                use_small = runtime_memory <= 4096
                executor = self.small_executor if use_small else self.large_executor

                logger.info(f'executor.map({func.__name__}, {len(args)} items, {runtime_memory}MB)')
                if executor.config['lithops']['executor'] == 'standalone':
                    futures: List[ResponseFuture] = executor.map(wrapper_func, args, **kwargs)
                else:
                    futures: List[ResponseFuture] = executor.map(
                        wrapper_func, args, runtime_memory=runtime_memory, **kwargs
                    )

                # TODO: debug logic:
                # * retry with more memory if there is an OOM
                # * try to record stats, even if a task fails

                return_vals = executor.get_result(futures)

                results = [result for result, meta in return_vals]
                metas = [meta for result, meta in return_vals]

                if not use_small:
                    total_time = sum(meta['inner_time'] for meta in metas if meta)
                    PipelineStats.append_vm(func.__name__, total_time)
                else:
                    PipelineStats.append_pywren(futures, runtime_memory)

                if unpack:
                    return zip(*results)
                else:
                    return results

            except MemoryError:
                old_memory = runtime_memory
                runtime_memory *= 2
                if runtime_memory > 8192:
                    logger.error(f'{func.__name__} used too much memory')
                    raise
                else:
                    logger.warning(
                        f'{func.__name__} ran out of memory with {old_memory}MB, retrying with {runtime_memory}MB'
                    )

    def call(self, func, args, *, runtime_memory=None):
        return self.map(func, [args], runtime_memory=runtime_memory)[0]

    def clean(self):
        for executor in {self.small_executor, self.large_executor}:
            executor.clean()

    def shutdown(self):
        for executor in {self.small_executor, self.large_executor}:
            executor.invoker.stop()
            try:
                executor.dismantle()
            except AttributeError:
                pass  # `dismantle` only exists on standalone compute handler class

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.shutdown()

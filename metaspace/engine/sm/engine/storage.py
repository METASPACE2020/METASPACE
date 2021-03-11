import boto3
import botocore.exceptions

from sm.engine.config import SMConfig


def _boto_client_kwargs():
    sm_config = SMConfig.get_conf()
    boto_config = boto3.session.Config(signature_version='s3v4')
    if 'aws' in sm_config:
        return dict(
            region_name=sm_config['aws']['aws_default_region'],
            aws_access_key_id=sm_config['aws']['aws_access_key_id'],
            aws_secret_access_key=sm_config['aws']['aws_secret_access_key'],
            config=boto_config,
        )
    return dict(
        endpoint_url=sm_config['storage']['endpoint_url'],
        aws_access_key_id=sm_config['storage']['access_key_id'],
        aws_secret_access_key=sm_config['storage']['secret_access_key'],
        config=boto_config,
    )


def get_s3_client():
    return boto3.client('s3', **_boto_client_kwargs())


def get_s3_resource():
    return boto3.resource('s3', **_boto_client_kwargs())


def create_bucket(bucket_name: str):
    s3_client = get_s3_client()
    try:
        s3_client.head_bucket(Bucket=bucket_name)
    except botocore.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            s3_client.create_bucket(Bucket=bucket_name)
        else:
            raise


def get_s3_bucket(bucket_name: str):
    return get_s3_resource().Bucket(bucket_name)

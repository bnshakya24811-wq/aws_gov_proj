import sys
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from datetime import datetime

# Get job parameters
args = getResolvedOptions(sys.argv, ['JOB_NAME', 'database_name', 'table_name', 'bucket_name'])

# Initialize Glue context
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Sample data to insert
data = [
    (1, "Alice", "alice@example.com", "123-45-6789", datetime.now()),
    (2, "Bob", "bob@example.com", "987-65-4321", datetime.now()),
    (3, "Charlie", "charlie@example.com", "555-12-3456", datetime.now()),
    (4, "Diana", "diana@example.com", "444-87-6543", datetime.now()),
    (5, "Eve", "eve@example.com", "222-33-4444", datetime.now())
]

# Create DataFrame
columns = ["id", "name", "email", "ssn", "created_at"]
df = spark.createDataFrame(data, columns)

# Write to S3 in Parquet format
output_path = f"s3://{args['bucket_name']}/data/sample_data/"
df.write.mode("append").parquet(output_path)

print(f"Successfully inserted {df.count()} records to {output_path}")
print(f"Database: {args['database_name']}, Table: {args['table_name']}")

job.commit()

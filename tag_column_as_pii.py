import boto3
import sys
import os

def get_param(name):
    # Glue passes params as --key value, not --key=value
    if f'--{name}' in sys.argv:
        idx = sys.argv.index(f'--{name}')
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return os.environ.get(name)

def main():
    db = get_param('db')
    table = get_param('table')
    column = get_param('column')
    if not db or not table or not column:
        print("Usage: --db <database> --table <table> --column <column>")
        sys.exit(1)

    client = boto3.client('lakeformation')

    response = client.add_lf_tags_to_resource(
        Resource={
            'TableWithColumns': {
                'CatalogId': boto3.client('sts').get_caller_identity()['Account'],
                'DatabaseName': db,
                'Name': table,
                'ColumnNames': [column]
            }
        },
        LFTags=[
            {
                'TagKey': 'PII',
                'TagValues': ['true']
            }
        ]
    )
    print("Tagging response:", response)

if __name__ == "__main__":
    main()

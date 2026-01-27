#!/bin/bash
# Build and deploy OAuth Lambda function

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$SCRIPT_DIR/lambdas-oauth"
OUTPUT_DIR="$SCRIPT_DIR/build"
ZIP_FILE="oauth-query-handler.zip"

echo "🔨 Building OAuth Lambda function..."

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Clean previous build
rm -f "$OUTPUT_DIR/$ZIP_FILE"

# Create temporary build directory
BUILD_DIR=$(mktemp -d)
trap "rm -rf $BUILD_DIR" EXIT

# Copy Lambda code
cp "$LAMBDA_DIR/index.py" "$BUILD_DIR/"
cp "$LAMBDA_DIR/requirements.txt" "$BUILD_DIR/"

# Install dependencies if requirements.txt has packages
if [ -s "$BUILD_DIR/requirements.txt" ]; then
    echo "📦 Installing Python dependencies..."
    pip install -r "$BUILD_DIR/requirements.txt" -t "$BUILD_DIR/" --quiet
else
    echo "ℹ️  No external dependencies (using boto3 from Lambda runtime)"
fi

# Create ZIP file
cd "$BUILD_DIR"
zip -r "$OUTPUT_DIR/$ZIP_FILE" . -q

echo "✅ Built: $OUTPUT_DIR/$ZIP_FILE"
echo ""
echo "📤 Upload this file to S3:"
echo "   aws s3 cp $OUTPUT_DIR/$ZIP_FILE s3://deploymen-bkt/lambda/"
echo ""
echo "🚀 Then deploy the stack with:"
echo "   aws cloudformation deploy \\"
echo "     --template-file main.yaml \\"
echo "     --stack-name lf-lh-nested-o-sp6-dev \\"
echo "     --parameter-overrides EnableOAuth=true \\"
echo "     --capabilities CAPABILITY_NAMED_IAM"

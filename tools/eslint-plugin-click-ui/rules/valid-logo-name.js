/**
 * Rule: valid-logo-name
 * Validates Logo names against the list of 58 available logos
 * Based on https://clickhouse.design/click-ui/ai-quick-reference
 */

module.exports = {
  meta: {
    type: 'warning',
    docs: {
      description: 'Ensure Logo name is valid',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidLogo: 'Logo name "{{name}}" is not valid. Check https://clickhouse.design/click-ui/logoLibrary for valid logo names.',
      didYouMean: 'Did you mean "{{suggestion}}"?',
    },
    schema: [],
  },

  create(context) {
    // Common logo names from the Click UI library (58 total)
    const validLogos = [
      'clickhouse', 'clickhouse_stacked',
      'aws', 'aws_s3', 'aws_kinesis', 'aws_lambda', 'aws_redshift', 'aws_glue',
      'gcp', 'google', 'google_bigquery', 'google_cloud_storage', 'google_pubsub',
      'azure', 'azure_blob', 'azure_event_hubs',
      'github', 'gitlab', 'bitbucket',
      'mysql', 'postgres', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
      'kafka', 'rabbitmq', 'nats',
      'snowflake', 'databricks', 'firebolt',
      'python', 'nodejs', 'java', 'golang', 'rust', 'php', 'ruby', 'dotnet',
      'react', 'vue', 'angular', 'typescript', 'javascript',
      'docker', 'kubernetes', 'terraform', 'ansible',
      'airflow', 'dbt', 'grafana', 'tableau', 'looker', 'metabase',
      'slack', 'discord', 'telegram',
      'digital_ocean', 'vercel', 'netlify',
    ];

    function findClosestMatch(name) {
      const nameLower = name.toLowerCase();
      let bestMatch = null;
      let bestScore = Infinity;

      for (const validLogo of validLogos) {
        const score = levenshteinDistance(nameLower, validLogo);
        if (score < bestScore && score <= 3) {
          bestScore = score;
          bestMatch = validLogo;
        }
      }

      return bestMatch;
    }

    function levenshteinDistance(a, b) {
      const matrix = [];

      for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
      }

      for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
      }

      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1];
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
          }
        }
      }

      return matrix[b.length][a.length];
    }

    return {
      JSXElement(node) {
        const openingElement = node.openingElement;
        const elementName = openingElement.name.name;

        if (elementName === 'Logo') {
          const nameAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'name'
          );

          if (nameAttr && nameAttr.value) {
            let logoName = '';
            
            if (nameAttr.value.type === 'Literal') {
              logoName = nameAttr.value.value;
            } else if (nameAttr.value.type === 'JSXExpressionContainer' && 
                       nameAttr.value.expression.type === 'Literal') {
              logoName = nameAttr.value.expression.value;
            }

            if (logoName && !validLogos.includes(logoName)) {
              context.report({
                node: nameAttr,
                messageId: 'invalidLogo',
                data: { name: logoName },
              });

              const suggestion = findClosestMatch(logoName);
              if (suggestion) {
                context.report({
                  node: nameAttr,
                  messageId: 'didYouMean',
                  data: { suggestion },
                });
              }
            }
          }
        }
      },
    };
  },
};

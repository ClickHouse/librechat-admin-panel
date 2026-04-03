/**
 * Rule: valid-icon-name
 * Validates Icon names against the list of 165 available icons
 * Based on https://clickhouse.design/click-ui/ai-quick-reference
 */

module.exports = {
  meta: {
    type: 'warning',
    docs: {
      description: 'Ensure Icon name is valid',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      invalidIcon: 'Icon name "{{name}}" is not valid. Check https://clickhouse.design/click-ui/iconLibrary for valid icon names.',
      didYouMean: 'Did you mean "{{suggestion}}"?',
    },
    schema: [],
  },

  create(context) {
    // Icon names from the Click UI library (165 total)
    // Full list: https://clickhouse.design/click-ui/iconLibrary
    const validIcons = [
      'activity', 'alarm', 'arrow-down', 'arrow-left', 'arrow-right', 'arrow-triangle', 'arrow-directions', 'arrow-up',
      'auth-app', 'auth-sms', 'backups', 'bar-chart', 'bell', 'beta', 'blog', 'bold', 'book', 'brackets', 'briefcase', 'building',
      'burger-menu', 'calendar', 'calendar-with-time', 'cards', 'cell-tower', 'chat', 'chart-area', 'chart-bar-horizontal',
      'chart-donut', 'chart-heatmap', 'chart-scatter', 'chart-stacked-horizontal', 'chart-stacked-vertical', 'check', 'check-in-circle',
      'chevron-down', 'chevron-left', 'chevron-right', 'chevron-up', 'circle', 'clock', 'cloud', 'cloud-keys', 'code', 'code-in-square',
      'connect', 'connect-alt', 'console', 'copy', 'cpu', 'cross', 'credit-card', 'data', 'database', 'data-lakes', 'disk', 'display',
      'document', 'dot', 'dots-horizontal', 'dots-triangle', 'dots-vertical', 'dots-vertical-double', 'double-check', 'download',
      'download-in-circle', 'email', 'empty', 'enter', 'eye', 'eye-closed', 'filter', 'fire', 'flag', 'flash', 'flask', 'folder-closed',
      'folder-open', 'gear', 'gift', 'git-merge', 'globe', 'hexagon', 'history', 'horizontal-loading', 'home', 'http', 'http-monitoring',
      'info-in-circle', 'information', 'insert-row', 'integrations', 'italic', 'key', 'keys', 'lifebuoy', 'light-bulb', 'light-bulb-on',
      'lightening', 'line-in-circle', 'list-bulleted', 'list-numbered', 'loading', 'loading-animated', 'lock', 'map-pin', 'metrics',
      'metrics-alt', 'minus', 'mcp', 'moon', 'no-cloud', 'pause', 'payment', 'pencil', 'pie-chart', 'pipe', 'play', 'play-in-circle',
      'plug', 'plus', 'popout', 'puzzle-piece', 'query', 'question', 'resize-arrows-horizontal', 'resize-arrows-vertical', 'refresh',
      'rocket', 'sandglass', 'search', 'secure', 'server', 'services', 'settings', 'share', 'share-arrow', 'share-network', 'sleep',
      'slide-in', 'slide-out', 'sort-alt', 'sort', 'sparkle', 'speaker', 'speed', 'square', 'star', 'stop', 'support', 'table', 'taxi',
      'text-slash', 'thumbs-down', 'thumbs-up', 'trash', 'tree-structure', 'upgrade', 'upload', 'url', 'user', 'users', 'underline',
      'warning', 'waves',
    ];

    function findClosestMatch(name) {
      const nameLower = name.toLowerCase();
      let bestMatch = null;
      let bestScore = Infinity;

      for (const validIcon of validIcons) {
        const score = levenshteinDistance(nameLower, validIcon);
        if (score < bestScore && score <= 3) {
          bestScore = score;
          bestMatch = validIcon;
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

        if (elementName === 'Icon') {
          const nameAttr = openingElement.attributes.find(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'name'
          );

          if (nameAttr && nameAttr.value) {
            let iconName = '';
            
            if (nameAttr.value.type === 'Literal') {
              iconName = nameAttr.value.value;
            } else if (nameAttr.value.type === 'JSXExpressionContainer' && 
                       nameAttr.value.expression.type === 'Literal') {
              iconName = nameAttr.value.expression.value;
            }

            if (iconName && !validIcons.includes(iconName)) {
              context.report({
                node: nameAttr,
                messageId: 'invalidIcon',
                data: { name: iconName },
              });

              const suggestion = findClosestMatch(iconName);
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

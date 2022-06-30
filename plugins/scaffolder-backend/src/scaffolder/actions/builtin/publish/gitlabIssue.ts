/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { createTemplateAction } from '../../createTemplateAction';
import { Gitlab } from '@gitbeaker/node';
import { Types } from '@gitbeaker/core';
import path from 'path';
import { ScmIntegrationRegistry } from '@backstage/integration';
import { InputError } from '@backstage/errors';
import { parseRepoUrl } from './util';
import { resolveSafeChildPath } from '@backstage/backend-common';
import { serializeDirectoryContents } from '../../../../lib/files';

/**
 * Create a new action that creates a gitlab merge request.
 *
 * @public
 */
export const createPublishGitlabIssueAction = (options: {
  integrations: ScmIntegrationRegistry;
}) => {
  const { integrations } = options;

  return createTemplateAction<{
    repoUrl: string;
    title: string;
    description: string;
    branchName: string;
    targetPath: string;
    token?: string;
    /** @deprecated Use projectPath instead */
    projectid?: string;
    removeSourceBranch?: boolean;
  }>({
    id: 'publish:gitlab:create-issue',
    schema: {
      input: {
        required: ['repoUrl', 'targetPath', 'branchName'],
        type: 'object',
        properties: {
          repoUrl: {
            type: 'string',
            title: 'Repository Location',
            description: `Accepts the format 'gitlab.com/group_name/project_name' where 'project_name' is the repository name and 'group_name' is a group or username`,
          },
          /** @deprecated Use projectPath instead */
          projectid: {
            type: 'string',
            title: 'projectid',
            description: 'Project ID/Name(slug) of the Gitlab Project',
          },
          title: {
            type: 'string',
            title: 'Merge Request Name',
            description: 'The name for the merge request',
          },
          description: {
            type: 'string',
            title: 'Merge Request Description',
            description: 'The description of the merge request',
          },
          branchName: {
            type: 'string',
            title: 'Destination Branch name',
            description: 'The description of the merge request',
          },
          targetPath: {
            type: 'string',
            title: 'Repository Subdirectory',
            description: 'Subdirectory of repository to apply changes to',
          },
          token: {
            title: 'Authentication Token',
            type: 'string',
            description: 'The token to use for authorization to GitLab',
          },
          removeSourceBranch: {
            title: 'Delete source branch',
            type: 'boolean',
            description:
              'Option to delete source branch once the MR has been merged. Default: false',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          projectid: {
            title: 'Gitlab Project id/Name(slug)',
            type: 'string',
          },
          projectPath: {
            title: 'Gitlab Project path',
            type: 'string',
          },
          mergeRequestURL: {
            title: 'MergeRequest(MR) URL',
            type: 'string',
            description: 'Link to the merge request in GitLab',
          },
        },
      },
    },
    async handler(ctx) {
      const repoUrl = ctx.input.repoUrl;
      const { host, owner, repo } = parseRepoUrl(repoUrl, integrations);
      let projectPath = `${owner}/${repo}`;

      if (ctx.input.projectid) {
        const deprecationWarning = `Property "projectid" is deprecated and no longer to needed to create a MR`;
        ctx.logger.warn(deprecationWarning);
        console.warn(deprecationWarning);
        projectPath = ctx.input.projectid;
      }

      const integrationConfig = integrations.gitlab.byHost(host);

      if (!integrationConfig) {
        throw new InputError(
          `No matching integration configuration for host ${host}, please check your integrations config`,
        );
      }

      if (!integrationConfig.config.token && !ctx.input.token) {
        throw new InputError(`No token available for host ${host}`);
      }

      const token = ctx.input.token ?? integrationConfig.config.token!;
      const tokenType = ctx.input.token ? 'oauthToken' : 'token';

      const api = new Gitlab({
        host: integrationConfig.config.baseUrl,
        [tokenType]: token,
      });

      const targetPath = resolveSafeChildPath(
        ctx.workspacePath,
        ctx.input.targetPath,
      );
      const fileContents = await serializeDirectoryContents(targetPath, {
        gitignore: true,
      });

      const desc = fileContents.map(file => file.content.toString()).join();

      const projects = await api.Projects.show(projectPath);
      console.log('got project', projects);

      const issue = {
        title: ctx.input.title,
        description: desc,
        labels: ['onboarding'],
      };
      console.log('Trying to create issue ', issue);

      try {
        const issueRes = await api.Issues.create(projects.id, issue);
        console.log('Issue Created', issueRes);

        ctx.output('projectid', projectPath);
        ctx.output('projectPath', projectPath);
        ctx.output('mergeRequestUrl', issueRes.web_url);
      } catch (e) {
        throw new InputError(
          `Creating the issue to ${projectPath} failed ${e}`,
        );
      }
    },
  });
};

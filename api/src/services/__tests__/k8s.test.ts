import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the k8s classes before importing the module that uses them
vi.mock('@kubernetes/client-node', () => {
    class KubeConfig {
        loadFromDefault = vi.fn();
        makeApiClient = vi.fn().mockReturnValue({
            createNamespacedPersistentVolumeClaim: vi.fn(),
            createNamespacedDeployment: vi.fn(),
            patchNamespacedDeploymentScale: vi.fn(),
            deleteNamespacedDeployment: vi.fn(),
            deleteNamespacedPersistentVolumeClaim: vi.fn(),
            readNamespacedDeployment: vi.fn(),
            patchNamespacedDeployment: vi.fn(),
            listNamespacedDeployment: vi.fn(),
        });
    }

    const AppsV1Api = vi.fn();
    const CoreV1Api = vi.fn();

    return { KubeConfig, AppsV1Api, CoreV1Api };
});

import { k8sApi, k8sCoreApi, startContainer, type ProvisionContainerParams } from '../k8s.js';

describe('k8s.ts - Kubernetes Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('startContainer', () => {
        it('creates a PVC and Deployment with the correct environment block inside K8s', async () => {
            // Setup mock resolutions for API calls
            vi.mocked(k8sCoreApi.createNamespacedPersistentVolumeClaim).mockResolvedValue({} as any);
            vi.mocked(k8sApi.createNamespacedDeployment).mockResolvedValue({} as any);

            const params: ProvisionContainerParams = {
                slug: 'test-bot-1',
                tenantId: 'uuid-1234',
                name: 'Test Tenant',
                port: 18789,
                language: 'en',
                flavor: 'real-estate',
                region: 'us-east1',
                databaseUrl: 'postgres://localhost',
                redisUrl: 'redis://localhost',
                botToken: 'bot1234',
            };

            const deploymentName = await startContainer(params);

            expect(deploymentName).toBe('tiger-claw-test-bot-1');

            // 1. Verify PVC creation
            expect(k8sCoreApi.createNamespacedPersistentVolumeClaim).toHaveBeenCalledWith(
                'default',
                expect.objectContaining({
                    metadata: { name: 'tiger-claw-test-bot-1-pvc' },
                })
            );

            // 2. Verify Deployment creation
            expect(k8sApi.createNamespacedDeployment).toHaveBeenCalledWith(
                'default',
                expect.objectContaining({
                    metadata: { name: 'tiger-claw-test-bot-1' },
                    spec: expect.objectContaining({
                        template: expect.objectContaining({
                            spec: expect.objectContaining({
                                containers: expect.arrayContaining([
                                    expect.objectContaining({
                                        env: expect.arrayContaining([
                                            { name: 'TENANT_ID', value: 'uuid-1234' },
                                            { name: 'BOT_FLAVOR', value: 'real-estate' },
                                            { name: 'TELEGRAM_BOT_TOKEN', value: 'bot1234' },
                                        ]),
                                    }),
                                ]),
                            }),
                        }),
                    }),
                })
            );
        });
    });
});

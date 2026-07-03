import { Test, TestingModule } from '@nestjs/testing';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        BullBoardModule.forRoot({ route: '/queues', adapter: ExpressAdapter }),
        QueueModule,
      ],
    }).compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('compiles without error', () => {
    expect(module).toBeDefined();
  });

  it('BullModule.registerQueue expõe a fila video-processing para injeção', () => {
    const { getQueueToken } =
      jest.requireActual<typeof import('@nestjs/bullmq')>('@nestjs/bullmq');
    const queue: unknown = module.get(getQueueToken('video-processing'), {
      strict: false,
    });
    expect(queue).toBeDefined();
  });
});

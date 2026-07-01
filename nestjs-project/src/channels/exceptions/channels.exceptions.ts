import { DomainException } from '../../common/exceptions/domain.exception';

export class ChannelSlugTakenException extends DomainException {
  constructor() {
    super('CHANNEL_SLUG_TAKEN', 409, 'Channel slug is already taken');
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel not found');
  }
}

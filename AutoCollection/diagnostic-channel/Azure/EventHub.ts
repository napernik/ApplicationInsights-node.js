// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.
import { SpanKind } from "@opentelemetry/api";
import { hrTimeToMilliseconds } from "@opentelemetry/core";
import { SemanticAttributes } from "@opentelemetry/semantic-conventions";
import { ReadableSpan } from "@opentelemetry/tracing";

import {
    TIME_SINCE_ENQUEUED,
    ENQUEUED_TIME,
    AzNamespace,
    MessageBusDestination,
    MicrosoftEventHub,
    DependencyTypeName
} from "../../../Declarations/Constants";
import { DependencyTelemetry, Identified, RequestTelemetry } from "../../../Declarations/Contracts";

/**
 * Average span.links[].attributes.enqueuedTime
 */
const getTimeSinceEnqueued = (span: ReadableSpan) => {
    let countEnqueueDiffs = 0;
    let sumEnqueueDiffs = 0;
    const startTimeMs = hrTimeToMilliseconds(span.startTime);

    span.links.forEach(({ attributes }) => {
        const enqueuedTime = attributes?.[ENQUEUED_TIME] as string | number;
        if (enqueuedTime) {
            countEnqueueDiffs += 1;
            sumEnqueueDiffs += startTimeMs - (parseFloat(enqueuedTime.toString()) || 0);
        }
    });

    return Math.max(sumEnqueueDiffs / (countEnqueueDiffs || 1), 0);
};

/**
 * Implementation of Mapping to Azure Monitor
 *
 * https://gist.github.com/lmolkova/e4215c0f44a49ef824983382762e6b92#file-z_azure_monitor_exporter_mapping-md
 */
export const parseEventHubSpan = (span: ReadableSpan, telemetry: (DependencyTelemetry | RequestTelemetry) & Identified): void => {
    const namespace = span.attributes[AzNamespace] as typeof MicrosoftEventHub;
    const peerAddress = ((span.attributes[SemanticAttributes.NET_PEER_NAME] ||
        span.attributes["peer.address"] ||
        "unknown") as string).replace(/\/$/g, ""); // remove trailing "/"
    const messageBusDestination = (span.attributes[MessageBusDestination] || "unknown") as string;

    switch (span.kind) {
        case SpanKind.CLIENT:
            (<DependencyTelemetry>telemetry).dependencyTypeName = namespace;
            (<DependencyTelemetry>telemetry).target = `${peerAddress}/${messageBusDestination}`;
            break;
        case SpanKind.PRODUCER:
            (<DependencyTelemetry>telemetry).dependencyTypeName = `${DependencyTypeName.QueueMessage} | ${namespace}`;
            (<DependencyTelemetry>telemetry).target = `${peerAddress}/${messageBusDestination}`;
            break;
        case SpanKind.CONSUMER:
            (<RequestTelemetry>telemetry).source = `${peerAddress}/${messageBusDestination}`;
            (<RequestTelemetry>telemetry).measurements = {
                ...(<RequestTelemetry>telemetry).measurements,
                [TIME_SINCE_ENQUEUED]: getTimeSinceEnqueued(span)
            };
            break;
        default: // no op
    }
};
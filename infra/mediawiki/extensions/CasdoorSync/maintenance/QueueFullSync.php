<?php
/**
 * Queues one casdoorSync job in mode=full: every OIDC-linked wiki account is
 * reconciled against Casdoor (name, groups, block). Without it a role changed
 * in Casdoor reaches the wiki only at that user's next login.
 *
 * The mediawiki-jobs service (infra/docker-compose.yml) runs this once a day.
 *   php maintenance/run.php /var/www/html/extensions/CasdoorSync/maintenance/QueueFullSync.php
 */

use MediaWiki\MediaWikiServices;

$IP = getenv( 'MW_INSTALL_PATH' );
if ( $IP === false ) {
    $IP = __DIR__ . '/../../..';
}
require_once "$IP/maintenance/Maintenance.php";

class QueueFullSync extends Maintenance {
    public function __construct() {
        parent::__construct();
        $this->addDescription( 'Queue a full Casdoor → wiki sync job' );
        $this->requireExtension( 'CasdoorSync' );
    }

    public function execute() {
        MediaWikiServices::getInstance()->getJobQueueGroup()->push( new JobSpecification(
            'casdoorSync', [ 'mode' => 'full' ], [], Title::newMainPage()
        ) );
        $this->output( "Queued casdoorSync mode=full\n" );
    }
}

$maintClass = QueueFullSync::class;
require_once RUN_MAINTENANCE_IF_MAIN;
